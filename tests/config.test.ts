import { describe, expect, it } from "vitest";
import { readParagraphCount, readWorkflowConfig } from "../src/core/config";

describe("workflow configuration", () => {
  it("reads defaults and the primary token", () => {
    expect(readWorkflowConfig({ CAPACITIES_API_TOKEN: " cap-api-secret " })).toEqual({
      apiToken: "cap-api-secret",
      paragraphCount: 3,
      connectTimeoutSeconds: 10,
      requestTimeoutSeconds: 45,
      retries: 2
    });
  });

  it("reads custom values", () => {
    expect(
      readWorkflowConfig({
        CAPACITIES_API_TOKEN: "cap-api-custom",
        CAPACITIES_PARAGRAPH_COUNT: "0",
        CAPACITIES_SOCKS5_PROXY: "socks5h://localhost:1080",
        CAPACITIES_CONNECT_TIMEOUT: "2",
        CAPACITIES_REQUEST_TIMEOUT: "20",
        CAPACITIES_RETRIES: "5"
      })
    ).toEqual({
      apiToken: "cap-api-custom",
      paragraphCount: 0,
      proxy: "socks5h://localhost:1080",
      connectTimeoutSeconds: 2,
      requestTimeoutSeconds: 20,
      retries: 5
    });
  });

  it("rejects missing and malformed tokens", () => {
    expect(() => readWorkflowConfig({})).toThrow("token is missing");
    expect(() => readWorkflowConfig({ CAPACITIES_API_TOKEN: "legacy" })).toThrow("cap-api-");
  });

  it("validates integer settings", () => {
    expect(readParagraphCount(undefined)).toBe(3);
    expect(readParagraphCount(" ")).toBe(3);
    expect(() => readParagraphCount("1.5")).toThrow("whole number");
    expect(() => readParagraphCount("21")).toThrow("whole number");
  });
});
