import { build } from "esbuild";
import { mkdir, rm, copyFile } from "node:fs/promises";

const outdir = "dist";
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

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

await copyFile("info.plist", "dist/info.plist");
await copyFile("icon.png", "dist/icon.png");
