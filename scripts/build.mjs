import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { build as buildPlist, parse as parsePlist } from "plist";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const configuration = JSON.parse(await readFile("workflow.config.json", "utf8"));
const keywords = configuration?.keywords;
const keywordEntries = [
  ["A1_KEYWORD", keywords?.dailyNote],
  ["A3_TODAY", keywords?.dailyLog],
  ["A4_WEBLINK", keywords?.weblink]
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
    external: ["buffer", "crypto"],
    platform: "neutral",
    mainFields: ["module", "main"],
    format: "iife",
    globalName: entry.globalName,
    target: ["es2020"],
    minify: false,
    legalComments: "eof",
    footer: { js: entry.footer }
  });
}

const plist = parsePlist(await readFile("info.plist", "utf8"));
if (!plist || typeof plist !== "object" || !Array.isArray(plist.objects)) {
  throw new Error("info.plist does not contain an Alfred objects array.");
}
for (const [uid, value] of keywordEntries) {
  const object = plist.objects.find((candidate) => candidate?.uid === uid);
  if (!object?.config || typeof object.config !== "object") {
    throw new Error(`info.plist is missing keyword object ${uid}.`);
  }
  object.config.keyword = value;
}
await writeFile("dist/info.plist", buildPlist(plist));
await copyFile("icon.png", "dist/icon.png");
