export interface HttpRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type HttpTransport = (request: HttpRequest) => HttpResponse;
export type Sleep = (milliseconds: number) => void;

export interface WeblinkJob {
  kind: "weblink";
  title: string;
  url: string;
  markdown: string;
}

export type WeblinkResult =
  | { outcome: "created"; id: string; title: string }
  | { outcome: "existing"; id: string; title: string };
