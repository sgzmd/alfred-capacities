import { readParagraphCount } from "../core/config";
import { combineWeblinkBody, formatMarkdownLink, normalizeParagraphs } from "../core/markdown";
import type { WeblinkJob } from "../core/types";
import { canonicalizeWebUrl } from "../core/url";
import {
  ensureDirectory,
  environment,
  initializeJxa,
  joinPath,
  launchWorker,
  notify,
  setPrivatePermissions,
  uniqueId,
  workflowDirectory,
  writeText
} from "./jxa";

interface CapturedPage {
  title: string;
  url: string;
  paragraphs: unknown;
}

function captureChromePage(paragraphCount: number): {
  title: string;
  url: string;
  markdown: string;
} {
  const chrome = Application("Google Chrome");
  if (chrome.windows.length === 0) {
    throw new Error("Ensure Chrome is open with an active tab.");
  }
  const tab = chrome.windows[0].activeTab();
  const title = String(tab.name());
  const url = canonicalizeWebUrl(String(tab.url()));
  const script = `(() => {
    const root = document.querySelector("article") || document.querySelector("main") || document.body;
    return JSON.stringify(Array.from(root.querySelectorAll("p")).map((paragraph) => paragraph.innerText));
  })();`;
  const raw = tab.execute({ javascript: script });
  const parsed: CapturedPage["paragraphs"] = raw ? JSON.parse(String(raw)) : [];
  return { title, url, markdown: normalizeParagraphs(parsed, paragraphCount) };
}

export function captureRun(argv: string[]): string {
  initializeJxa();
  try {
    const env = environment();
    const count = readParagraphCount(env.CAPACITIES_PARAGRAPH_COUNT);
    const page = captureChromePage(count);
    const clipboard = Application.currentApplication();
    clipboard.includeStandardAdditions = true;
    clipboard.setTheClipboardTo(formatMarkdownLink(page.title, page.url));
    notify(
      "Page Link Copied",
      "The Weblink will be saved to Capacities in the background.",
      page.title
    );

    const cache = env.alfred_workflow_cache || joinPath("/tmp", "cc.kirillov.alfred-capacities");
    ensureDirectory(cache);
    setPrivatePermissions(cache, true);
    const job: WeblinkJob = {
      kind: "weblink",
      title: page.title,
      url: page.url,
      markdown: combineWeblinkBody(argv[0] ?? "", page.markdown)
    };
    const jobPath = joinPath(cache, `weblink-${uniqueId()}.json`);
    writeText(jobPath, JSON.stringify(job));
    setPrivatePermissions(jobPath);
    launchWorker(joinPath(workflowDirectory(), "capacities-worker.js"), jobPath);
    return "Link copied";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify("Page Capture Error", message);
    return `ERROR: ${message}`;
  }
}
