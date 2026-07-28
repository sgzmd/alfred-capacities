export function escapeMarkdownLinkText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function formatMarkdownLink(title: string, url: string): string {
  const safeTitle = escapeMarkdownLinkText(title.trim() || url);
  const safeUrl = url.replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${safeTitle}](${safeUrl})`;
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
