import { build } from "esbuild";
import { mkdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const configuration = JSON.parse(await readFile("workflow.config.json", "utf8"));
const keywords = configuration?.keywords;
const keywordEntries = [
  ["__DAILY_NOTE_KEYWORD__", keywords?.dailyNote],
  ["__DAILY_LOG_KEYWORD__", keywords?.dailyLog],
  ["__WEBLINK_KEYWORD__", keywords?.weblink]
];

for (const [name, value] of keywordEntries) {
  if (typeof value !== "string" || !/^\S+$/.test(value)) {
    throw new Error(`${name} must be configured as one non-whitespace keyword.`);
  }
}

const uniqueKeywords = new Set(keywordEntries.map(([, value]) => value));
if (uniqueKeywords.size !== keywordEntries.length) {
  throw new Error("Alfred trigger keywords must be unique.");
}

const escapeXml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const entries = [
  {
    input: "src/runtime/capture.ts",
    output: "dist/capture.js",
    globalName: "CaptureWorkflow",
    footer: "function run(argv) { return CaptureWorkflow.captureRun(argv); }"
  },
  {
    input: "src/runtime/worker.ts",
    output: "dist/capacities-worker.js",
    globalName: "CapacitiesWorker",
    footer: "function run(argv) { return CapacitiesWorker.workerRun(argv); }"
  },
  {
    input: "src/runtime/daily-note.ts",
    output: "dist/daily-note.js",
    globalName: "DailyNoteWorkflow",
    footer: "function run(argv) { return DailyNoteWorkflow.dailyNoteRun(argv); }"
  },
  {
    input: "src/runtime/daily-note.ts",
    output: "dist/daily-log.js",
    globalName: "DailyLogWorkflow",
    footer: "function run(argv) { return DailyLogWorkflow.dailyLogRun(argv); }"
  }
];

for (const entry of entries) {
  await build({
    entryPoints: [entry.input],
    outfile: entry.output,
    bundle: true,
    platform: "neutral",
    format: "iife",
    globalName: entry.globalName,
    target: ["safari14"],
    minify: false,
    legalComments: "none",
    footer: { js: entry.footer }
  });
}

let plist = await readFile("info.plist", "utf8");
for (const [placeholder, value] of keywordEntries) {
  plist = plist.replaceAll(placeholder, escapeXml(value));
}
if (/__[A-Z_]+__/.test(plist)) {
  throw new Error("Unresolved placeholder found in info.plist.");
}
await writeFile("dist/info.plist", plist);
await copyFile("icon.png", "dist/icon.png");
