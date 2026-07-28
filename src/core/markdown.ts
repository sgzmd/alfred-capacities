import type { Root } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";

export function formatMarkdownLink(title: string, url: string): string {
  const tree: Root = {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url,
            children: [{ type: "text", value: title.trim() || url }]
          }
        ]
      }
    ]
  };
  return toMarkdown(tree, { resourceLink: true }).trimEnd();
}

export function normalizeParagraphs(values: unknown, count: number): string {
  if (!Array.isArray(values)) {
    return "";
  }

  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 40)
    .slice(0, Math.max(0, count))
    .join("\n\n");
}

export function formatDailyLog(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new Error("Daily Log content is empty.");
  }
  return `${text} #DailyLog`;
}
