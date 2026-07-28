import { describe, expect, it, vi } from "vitest";
import type { CapacitiesApi } from "../src/core/api";
import { saveWeblink, validateWeblinkJob } from "../src/core/workflows";

describe("Weblink workflow", () => {
  it("validates and normalizes jobs", () => {
    expect(
      validateWeblinkJob({
        kind: "weblink",
        title: " ",
        url: "https://example.com",
        markdown: "Excerpt"
      })
    ).toEqual({
      kind: "weblink",
      title: "https://example.com",
      url: "https://example.com",
      markdown: "Excerpt"
    });
  });

  it("rejects malformed jobs", () => {
    expect(() => validateWeblinkJob(null)).toThrow("invalid");
    expect(() => validateWeblinkJob({ kind: "other" })).toThrow("invalid");
    expect(() =>
      validateWeblinkJob({ kind: "weblink", title: "x", url: "file:///x", markdown: "" })
    ).toThrow("Only HTTP");
  });

  it("returns an existing object without creating", () => {
    const api = {
      findWeblink: vi.fn(() => ({ id: "existing", title: "Existing" })),
      createWeblink: vi.fn()
    } as unknown as CapacitiesApi;
    expect(
      saveWeblink(api, { kind: "weblink", title: "Page", url: "https://example.com", markdown: "" })
    ).toEqual({ outcome: "existing", id: "existing", title: "Existing" });
    expect(api.createWeblink).not.toHaveBeenCalled();
  });

  it("creates a missing object", () => {
    const api = {
      findWeblink: vi.fn(() => undefined),
      createWeblink: vi.fn(() => ({ id: "new", title: "Page" }))
    } as unknown as CapacitiesApi;
    expect(
      saveWeblink(api, {
        kind: "weblink",
        title: "Page",
        url: "https://example.com",
        markdown: "Excerpt"
      })
    ).toEqual({ outcome: "created", id: "new", title: "Page" });
  });
});
