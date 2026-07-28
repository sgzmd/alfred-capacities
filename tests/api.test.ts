import { describe, expect, it, vi } from "vitest";
import { CapacitiesApi, CapacitiesError } from "../src/core/api";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/core/types";

function response(status: number, body = "", headers: Record<string, string> = {}): HttpResponse {
  return { status, body, headers };
}

function object(
  id: string,
  url: string | null,
  title: string | null,
  urlKey = "url"
): Record<string, unknown> {
  return {
    id,
    structureId: "MediaWebResource",
    collections: [],
    properties: {
      [urlKey]: { type: "url", url: { value: url } },
      title: { type: "title", title: { value: title } }
    }
  };
}

function apiWith(
  transport: HttpTransport,
  retries = 0,
  sleep = vi.fn()
): { api: CapacitiesApi; sleep: ReturnType<typeof vi.fn> } {
  return { api: new CapacitiesApi(transport, { retries, sleep }), sleep };
}

describe("Capacities API adapter", () => {
  it("is pinned to the SDK API version", () => {
    expect(CapacitiesApi.version).toBe("0.1.0");
  });

  it("appends a Daily Note using the v1 route", () => {
    const transport = vi.fn(() => response(204));
    apiWith(transport).api.appendDailyNote("A note");
    expect(transport).toHaveBeenCalledWith({
      method: "POST",
      path: "/blocks/daily-note/append",
      body: { markdown: "A note" }
    });
  });

  it("finds a Weblink by exact canonical URL and deduplicates search candidates", () => {
    const requests: HttpRequest[] = [];
    const transport: HttpTransport = (request) => {
      requests.push(request);
      if (request.path === "/objects/search") {
        return response(
          200,
          JSON.stringify({
            results: [{ id: "11111111-1111-4111-8111-111111111111", structureId: "MediaWebResource", title: "Page" }]
          })
        );
      }
      return response(
        200,
        JSON.stringify(
          object("11111111-1111-4111-8111-111111111111", "https://EXAMPLE.com:443/a#x", "Canonical")
        )
      );
    };
    expect(apiWith(transport).api.findWeblink("https://example.com/a", "Page")).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Canonical"
    });
    expect(requests.filter((request) => request.path.startsWith("/object?"))).toHaveLength(1);
  });

  it("checks fallback URL properties and returns no inexact match", () => {
    let calls = 0;
    const transport: HttpTransport = (request) => {
      if (request.path === "/objects/search") {
        calls += 1;
        return response(
          200,
          JSON.stringify({
            results:
              calls === 1
                ? [{ id: "11111111-1111-4111-8111-111111111111", structureId: "MediaWebResource", title: "Other" }]
                : []
          })
        );
      }
      return response(
        200,
        JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          structureId: "MediaWebResource",
          collections: [],
          properties: {
            url: { type: "url", url: { value: null } },
            "custom-url": { type: "url", url: { value: "https://example.com/other" } },
            title: { type: "title", title: { value: null } }
          }
        })
      );
    };
    expect(apiWith(transport).api.findWeblink("https://example.com/wanted", "Different title")).toBeUndefined();
  });

  it("handles an object without a URL", () => {
    const transport: HttpTransport = (request) =>
      request.path === "/objects/search"
        ? response(
            200,
            JSON.stringify({
              results: [{ id: "11111111-1111-4111-8111-111111111111", structureId: "MediaWebResource", title: "Page" }]
            })
          )
        : response(
            200,
            JSON.stringify({
              id: "11111111-1111-4111-8111-111111111111",
              structureId: "MediaWebResource",
              collections: [],
              properties: {}
            })
          );
    expect(apiWith(transport).api.findWeblink("https://example.com", "https://example.com")).toBeUndefined();
  });

  it("creates Weblinks with and without Markdown", () => {
    const requests: HttpRequest[] = [];
    const transport: HttpTransport = (request) => {
      requests.push(request);
      return response(
        201,
        JSON.stringify(object("11111111-1111-4111-8111-111111111111", request.path, null))
      );
    };
    const api = apiWith(transport).api;
    expect(api.createWeblink("https://example.com", "Page", "Excerpt")).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Untitled Weblink"
    });
    api.createWeblink("https://example.com/2", "Page 2", "");
    expect(requests[0]?.body).toMatchObject({ markdown: "Excerpt" });
    expect(requests[1]?.body).not.toHaveProperty("markdown");
  });

  it("retries rate limits using the case-insensitive reset header", () => {
    const transport = vi
      .fn()
      .mockReturnValueOnce(response(429, '{"code":"cap_rate_limit_exceeded"}', { RateLimit: "limit=5, reset=3" }))
      .mockReturnValueOnce(response(204));
    const { api, sleep } = apiWith(transport, 1);
    api.appendDailyNote("Retry");
    expect(sleep).toHaveBeenCalledWith(3000);
  });

  it("uses exponential delays for retryable server failures", () => {
    const transport = vi
      .fn()
      .mockReturnValueOnce(response(500, "{}"))
      .mockReturnValueOnce(response(503, "{}"))
      .mockReturnValueOnce(response(204));
    const { api, sleep } = apiWith(transport, 2);
    api.appendDailyNote("Retry");
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("uses exponential delay when a rate-limit reset is absent or malformed", () => {
    const withoutHeader = vi
      .fn()
      .mockReturnValueOnce(response(429, "{}"))
      .mockReturnValueOnce(response(204));
    const first = apiWith(withoutHeader, 1);
    first.api.appendDailyNote("Retry");
    expect(first.sleep).toHaveBeenCalledWith(1000);

    const malformedHeader = vi
      .fn()
      .mockReturnValueOnce(response(429, "{}", { ratelimit: "remaining=0" }))
      .mockReturnValueOnce(response(204));
    const second = apiWith(malformedHeader, 1);
    second.api.appendDailyNote("Retry");
    expect(second.sleep).toHaveBeenCalledWith(1000);
  });

  it("retries network failures and reports the final failure", () => {
    const transport = vi.fn(() => {
      throw new Error("offline");
    });
    const { api, sleep } = apiWith(transport, 1);
    expect(() => api.appendDailyNote("Retry")).toThrow("Unable to reach Capacities: offline");
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not reuse a stale rate-limit delay after a network failure", () => {
    const transport = vi
      .fn()
      .mockReturnValueOnce(response(429, "{}", { ratelimit: "reset=9" }))
      .mockImplementationOnce(() => {
        throw new Error("temporary");
      })
      .mockReturnValueOnce(response(204));
    const { api, sleep } = apiWith(transport, 2);
    api.appendDailyNote("Retry");
    expect(sleep.mock.calls).toEqual([[9000], [2000]]);
  });

  it("handles non-Error network failures", () => {
    const transport = vi.fn(() => {
      throw "offline";
    });
    expect(() => apiWith(transport).api.appendDailyNote("Retry")).toThrow(
      "Unable to reach Capacities: offline"
    );
  });

  it("defensively handles an invalid negative retry configuration", () => {
    expect(() => apiWith(() => response(204), -1).api.appendDailyNote("No")).toThrow(
      "Unknown transport failure"
    );
  });

  it("throws structured API errors without retrying permanent failures", () => {
    const transport = vi.fn(() =>
      response(403, JSON.stringify({ code: "cap_scope_insufficient", message: "Missing scope", details: { missingScopes: ["api:write"] } }))
    );
    try {
      apiWith(transport, 2).api.appendDailyNote("No");
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(CapacitiesError);
      expect(error).toMatchObject({
        status: 403,
        code: "cap_scope_insufficient",
        message: "Missing scope",
        details: { missingScopes: ["api:write"] }
      });
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("falls back for malformed HTTP error bodies", () => {
    expect(() =>
      apiWith(() => response(400, "<html>bad</html>")).api.appendDailyNote("No")
    ).toThrow("HTTP 400");
  });

  it("rejects malformed success JSON", () => {
    expect(() =>
      apiWith(() => response(200, "not-json")).api.findWeblink("https://example.com", "Page")
    ).toThrow("invalid JSON");
  });
});
