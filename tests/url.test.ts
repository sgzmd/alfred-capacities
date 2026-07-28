import { describe, expect, it } from "vitest";
import { canonicalizeWebUrl, validateSocksProxy } from "../src/core/url";

describe("URL handling", () => {
  it("canonicalizes web URLs conservatively", () => {
    expect(canonicalizeWebUrl(" HTTPS://Example.COM:443/path?q=1#section ")).toBe(
      "https://example.com/path?q=1"
    );
    expect(canonicalizeWebUrl("http://EXAMPLE.com:80")).toBe("http://example.com/");
    expect(canonicalizeWebUrl("https://user@EXAMPLE.com:444/a")).toBe(
      "https://user@example.com:444/a"
    );
    expect(canonicalizeWebUrl("https://münich.example/a b")).toBe(
      "https://xn--mnich-kva.example/a%20b"
    );
  });

  it("handles IPv6 authorities", () => {
    expect(canonicalizeWebUrl("https://[::1]:443/a")).toBe("https://[::1]/a");
    expect(canonicalizeWebUrl("http://[::1]:8080")).toBe("http://[::1]:8080/");
    expect(() => canonicalizeWebUrl("https://[::1/path")).toThrow("invalid");
  });

  it("rejects unsupported or hostless page URLs", () => {
    expect(() => canonicalizeWebUrl("file:///tmp/a")).toThrow("Only HTTP");
    expect(() => canonicalizeWebUrl("https://example.com:invalid")).toThrow("invalid");
  });

  it("validates optional SOCKS5 proxies", () => {
    expect(validateSocksProxy("")).toBeUndefined();
    expect(validateSocksProxy(" SOCKS5H://127.0.0.1:1080/ ")).toBe("socks5h://127.0.0.1:1080");
    expect(validateSocksProxy("socks5://user:pass@localhost:1080")).toBe(
      "socks5://user:pass@localhost:1080"
    );
    expect(() => validateSocksProxy("http://localhost:8080")).toThrow("Proxy must");
    expect(() => validateSocksProxy("socks5://localhost:1080/path")).toThrow("Proxy must");
    expect(() => validateSocksProxy("socks5://local host:1080")).toThrow("Proxy must");
  });
});
