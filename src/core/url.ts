const HTTP_URL = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?(?:#.*)?$/i;
const SOCKS_URL = /^(socks5h?):\/\/([^/?#\s]+)\/?$/i;

function normalizeAuthority(authority: string, scheme: string): string {
  const at = authority.lastIndexOf("@");
  const userInfo = at >= 0 ? authority.slice(0, at + 1) : "";
  const hostPort = authority.slice(at + 1).toLowerCase();

  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end < 0) {
      throw new Error("URL contains an invalid IPv6 host.");
    }
    const host = hostPort.slice(0, end + 1);
    const port = hostPort.slice(end + 1);
    const defaultPort = (scheme === "http" && port === ":80") || (scheme === "https" && port === ":443");
    return `${userInfo}${host}${defaultPort ? "" : port}`;
  }

  const separator = hostPort.lastIndexOf(":");
  const host = separator >= 0 ? hostPort.slice(0, separator) : hostPort;
  const port = separator >= 0 ? hostPort.slice(separator) : "";
  const defaultPort = (scheme === "http" && port === ":80") || (scheme === "https" && port === ":443");
  return `${userInfo}${host}${defaultPort ? "" : port}`;
}

export function canonicalizeWebUrl(value: string): string {
  const input = value.trim();
  if (/^https?:\/\/\//i.test(input)) {
    throw new Error("Page URL is missing a host.");
  }
  const match = HTTP_URL.exec(input);
  if (!match) {
    throw new Error("Only HTTP and HTTPS page URLs are supported.");
  }

  const scheme = match[1]!.toLowerCase();
  const authority = normalizeAuthority(match[2]!, scheme);
  const path = match[3] || "/";
  const query = match[4] || "";
  return `${scheme}://${authority}${path}${query}`;
}

export function validateSocksProxy(value: string): string | undefined {
  const proxy = value.trim();
  if (!proxy) {
    return undefined;
  }
  const match = SOCKS_URL.exec(proxy);
  if (!match || !match[2]) {
    throw new Error("Proxy must be a socks5:// or socks5h:// URL without a path.");
  }
  return `${match[1]!.toLowerCase()}://${match[2]}`;
}
