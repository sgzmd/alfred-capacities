import { describe, expect, it } from "vitest";
import {
  escapeMarkdownLinkText,
  formatDailyLog,
  formatMarkdownLink,
  normalizeParagraphs
} from "../src/core/markdown";

describe("Markdown helpers", () => {
  it("escapes link labels and destinations", () => {
    expect(escapeMarkdownLinkText(String.raw`A [useful] \ page`)).toBe(String.raw`A \[useful\] \\ page`);
    expect(formatMarkdownLink(" A [page] ", String.raw`https://example.com/a_(b)\c`)).toBe(
      String.raw`[A \[page\]](https://example.com/a_%28b%29%5Cc)`
    );
  });

  it("uses the URL for a blank title", () => {
    expect(formatMarkdownLink("  ", "https://example.com")).toBe(
      "[https://example.com](https://example.com)"
    );
  });

  it("normalizes and limits substantive paragraphs", () => {
    const long = "This is a substantive paragraph with enough characters to pass the content filter.";
    expect(normalizeParagraphs([null, 3, " short ", ` ${long}\n`, `${long} second`], 1)).toBe(long);
    expect(normalizeParagraphs([long], -1)).toBe("");
    expect(normalizeParagraphs("not an array", 3)).toBe("");
  });

  it("formats Daily Log entries", () => {
    expect(formatDailyLog("  Completed the release  ")).toBe("Completed the release #DailyLog");
    expect(() => formatDailyLog(" \n ")).toThrow("Daily Log content is empty.");
  });
});
