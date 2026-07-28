import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/core/hash";

describe("SHA-256", () => {
  it("matches published vectors and hashes UTF-8 text", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(sha256Hex("✓")).toBe("1dabba21cdad44541f6b15796f8d22978fc7ea10c46aeceeeeb66c23b3ac7604");
  });
});
