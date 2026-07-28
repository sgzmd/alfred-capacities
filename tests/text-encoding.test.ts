import { describe, expect, it } from "vitest";
import { installTextEncoding } from "../src/core/text-encoding";

describe("JXA text encoding compatibility", () => {
  it("installs missing standards-compatible constructors", () => {
    const target = {} as {
      TextEncoder: typeof globalThis.TextEncoder;
      TextDecoder: typeof globalThis.TextDecoder;
    };
    installTextEncoding(target);
    expect(new target.TextEncoder().encode("✓")).toEqual(
      new Uint8Array([0xe2, 0x9c, 0x93])
    );
    expect(new target.TextDecoder().decode(new Uint8Array([0xe2, 0x9c, 0x93]))).toBe("✓");
  });

  it("preserves native constructors", () => {
    const target = {
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder
    };
    installTextEncoding(target);
    expect(target.TextEncoder).toBe(globalThis.TextEncoder);
    expect(target.TextDecoder).toBe(globalThis.TextDecoder);
  });
});
