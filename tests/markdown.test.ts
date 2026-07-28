import { describe, expect, it } from "vitest";
import {
  combineWeblinkBody,
  formatDailyLog,
  formatMarkdownLink,
  normalizeParagraphs
} from "../src/core/markdown";

describe("Markdown helpers", () => {
  it("escapes link labels and destinations", () => {
    expect(formatMarkdownLink(" A [page] ", "https://example.com/a_(b)")).toBe(
      String.raw`[A \[page\]](https://example.com/a_\(b\))`
    );
  });

  it("uses the URL for a blank title", () => {
    expect(formatMarkdownLink("  ", "https://example.com")).toBe(
      "[https://example.com](https://example.com)"
    );
  });

  it("normalizes and limits substantive paragraphs", () => {
    const long =
      "This is a substantive paragraph with enough characters to pass the content filter.";
    expect(normalizeParagraphs([null, 3, " short ", ` ${long}\n`, `${long} second`], 1)).toBe(long);
    expect(normalizeParagraphs([long], -1)).toBe("");
    expect(normalizeParagraphs("not an array", 3)).toBe("");
  });

  it("adds optional Weblink text verbatim before the page excerpt", () => {
    const supplied = "  First line\n*literal* [text](target)\nLast line  ";
    expect(combineWeblinkBody("", "Page excerpt")).toBe("Page excerpt");
    expect(combineWeblinkBody(supplied, "")).toBe(supplied);
    expect(combineWeblinkBody(supplied, "Page excerpt")).toBe(`${supplied}\n\nPage excerpt`);
  });

  it("formats Daily Log entries", () => {
    expect(formatDailyLog("  Completed the release  ")).toBe("Completed the release #DailyLog");
    expect(() => formatDailyLog(" \n ")).toThrow("Daily Log content is empty.");
  });
});
