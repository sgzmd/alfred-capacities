import "./text-encoding";
import { URL } from "whatwg-url";

function parseUrl(value: string, message: string): URL {
  try {
    return new URL(value.trim());
  } catch {
    throw new Error(message);
  }
}

export function canonicalizeWebUrl(value: string): string {
  const url = parseUrl(value, "Page URL is invalid.");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS page URLs are supported.");
  }
  url.hash = "";
  return url.href;
}

export function validateSocksProxy(value: string): string | undefined {
  const proxy = value.trim();
  if (!proxy) {
    return undefined;
  }
  const url = parseUrl(proxy, "Proxy must be a socks5:// or socks5h:// URL without a path.");
  if (
    (url.protocol !== "socks5:" && url.protocol !== "socks5h:") ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("Proxy must be a socks5:// or socks5h:// URL without a path.");
  }
  return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
}
