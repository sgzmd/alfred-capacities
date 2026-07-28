import type {
  CreateWeblinkBody,
  DailyNoteBody,
  ObjectResponse,
  SearchBody,
  SearchResponse
} from "./sdk-contract";
import { API_VERSION, WEBLINK_STRUCTURE_ID } from "./sdk-contract";
import type { HttpRequest, HttpResponse, HttpTransport, Sleep } from "./types";
import { canonicalizeWebUrl } from "./url";

interface ApiErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

export class CapacitiesError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CapacitiesError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface CapacitiesApiOptions {
  retries: number;
  sleep: Sleep;
}

function header(response: HttpResponse, name: string): string | undefined {
  const target = name.toLowerCase();
  const key = Object.keys(response.headers).find((candidate) => candidate.toLowerCase() === target);
  return key ? response.headers[key] : undefined;
}

function retryDelay(response: HttpResponse | undefined, attempt: number): number {
  if (response?.status === 429) {
    const value = header(response, "ratelimit");
    const match = value ? /(?:^|,\s*)reset=(\d+)/i.exec(value) : null;
    if (match) {
      return Number(match[1]) * 1000;
    }
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 503;
}

function parseJson<T>(body: string, context: string): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new CapacitiesError(0, "cap_invalid_response", `Capacities returned invalid JSON for ${context}.`);
  }
}

function errorFromResponse(response: HttpResponse): CapacitiesError {
  let body: ApiErrorBody = {};
  try {
    body = JSON.parse(response.body) as ApiErrorBody;
  } catch {
    // Non-JSON edge responses are represented by their HTTP status.
  }
  const code = typeof body.code === "string" ? body.code : "cap_http_error";
  const message =
    typeof body.message === "string" ? body.message : `Capacities request failed with HTTP ${response.status}.`;
  return new CapacitiesError(response.status, code, message, body.details);
}

function extractUrl(object: ObjectResponse): string | undefined {
  const preferred = object.properties.url;
  if (preferred?.type === "url" && preferred.url.value) {
    return preferred.url.value;
  }
  for (const value of Object.values(object.properties)) {
    if (value.type === "url" && value.url.value) {
      return value.url.value;
    }
  }
  return undefined;
}

function extractTitle(object: ObjectResponse): string {
  const preferred = object.properties.title;
  if (preferred?.type === "title" && preferred.title.value) {
    return preferred.title.value;
  }
  return "Untitled Weblink";
}

export class CapacitiesApi {
  static readonly version = API_VERSION;

  constructor(
    private readonly transport: HttpTransport,
    private readonly options: CapacitiesApiOptions
  ) {}

  private send<T>(request: HttpRequest, context: string, expectsJson = true): T {
    let lastResponse: HttpResponse | undefined;

    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      try {
        const response = this.transport(request);
        lastResponse = response;
        if (response.status >= 200 && response.status < 300) {
          return (expectsJson ? parseJson<T>(response.body, context) : undefined) as T;
        }
        if (!isRetryableStatus(response.status) || attempt === this.options.retries) {
          throw errorFromResponse(response);
        }
      } catch (error) {
        if (error instanceof CapacitiesError) {
          throw error;
        }
        lastResponse = undefined;
        if (attempt === this.options.retries) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CapacitiesError(0, "cap_network_error", `Unable to reach Capacities: ${message}`);
        }
      }
      this.options.sleep(retryDelay(lastResponse, attempt));
    }

    throw new CapacitiesError(0, "cap_network_error", "Unknown transport failure");
  }

  appendDailyNote(markdown: string): void {
    const body: DailyNoteBody = { markdown };
    this.send<void>(
      { method: "POST", path: "/blocks/daily-note/append", body },
      "Daily Note append",
      false
    );
  }

  findWeblink(url: string, title: string): { id: string; title: string } | undefined {
    const canonical = canonicalizeWebUrl(url);
    const searches = [url, title].filter((query, index, all) => query && all.indexOf(query) === index);
    const candidates: Array<{ id: string; title: string }> = [];

    for (const query of searches) {
      const body: SearchBody = {
        query,
        structureIds: [WEBLINK_STRUCTURE_ID],
        limit: 50
      };
      const response = this.send<SearchResponse>(
        { method: "POST", path: "/objects/search", body },
        "Weblink search"
      );
      for (const result of response.results) {
        if (!candidates.some((candidate) => candidate.id === result.id)) {
          candidates.push({ id: result.id, title: result.title });
        }
      }
    }

    for (const candidate of candidates) {
      const object = this.send<ObjectResponse>(
        { method: "GET", path: `/object?id=${encodeURIComponent(candidate.id)}` },
        "Weblink lookup"
      );
      const objectUrl = extractUrl(object);
      if (objectUrl && canonicalizeWebUrl(objectUrl) === canonical) {
        return { id: object.id, title: extractTitle(object) };
      }
    }
    return undefined;
  }

  createWeblink(url: string, title: string, markdown: string): { id: string; title: string } {
    const body: CreateWeblinkBody = {
      url,
      properties: {
        title: {
          type: "title",
          title: { value: title }
        }
      },
      ...(markdown ? { markdown } : {})
    };
    const object = this.send<ObjectResponse>(
      { method: "POST", path: "/object/url", body },
      "Weblink creation"
    );
    return { id: object.id, title: extractTitle(object) };
  }
}
