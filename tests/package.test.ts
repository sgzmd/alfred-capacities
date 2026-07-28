import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const onMac = process.platform === "darwin" ? it : it.skip;

describe("Alfred distribution", () => {
  it("contains only dependency-free runtime artifacts", () => {
    const files = [
      "info.plist",
      "icon.png",
      "daily-note.js",
      "daily-log.js",
      "capture.js",
      "capacities-worker.js"
    ];
    for (const file of files) {
      expect(existsSync(join(root, "dist", file)), file).toBe(true);
    }
    expect(readFileSync(join(root, "dist", "daily-note.js"), "utf8")).not.toContain(
      "@capacities/api"
    );
  });

  onMac("validates the plist and compiled JXA entry points", () => {
    expect(
      execFileSync("plutil", ["-lint", join(root, "dist", "info.plist")], {
        encoding: "utf8"
      })
    ).toContain("OK");
    expect(
      execFileSync("osascript", ["-l", "JavaScript", join(root, "dist", "daily-note.js"), ""], {
        encoding: "utf8"
      }).trim()
    ).toBe("ERROR: Note content is empty.");
    expect(
      execFileSync("osascript", ["-l", "JavaScript", join(root, "dist", "capacities-worker.js")], {
        encoding: "utf8"
      }).trim()
    ).toBe("ERROR: Missing Weblink job.");
  });

  onMac("runs bundled standards libraries inside JXA", () => {
    const directory = mkdtempSync(join(tmpdir(), "alfred-capacities-libraries-"));
    const output = join(directory, "libraries.js");
    try {
      buildSync({
        entryPoints: [join(root, "tests", "fixtures", "jxa-libraries.ts")],
        outfile: output,
        bundle: true,
        external: ["buffer", "crypto"],
        platform: "neutral",
        mainFields: ["module", "main"],
        format: "iife",
        globalName: "LibrarySmoke",
        target: ["es2020"],
        legalComments: "eof",
        footer: { js: "function run() { return LibrarySmoke.librarySmokeRun(); }" }
      });
      const result = JSON.parse(
        execFileSync("osascript", ["-l", "JavaScript", output], { encoding: "utf8" })
      ) as { url: string; markdown: string; hash: string };
      expect(result).toEqual({
        url: "https://xn--mnich-kva.example/a%20b",
        markdown: String.raw`[A \[page\]](https://example.com/a_\(b\))`,
        hash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  onMac("injects top-level trigger configuration into the packaged plist", () => {
    const configuration = JSON.parse(readFileSync(join(root, "workflow.config.json"), "utf8")) as {
      keywords: { dailyNote: string; dailyLog: string; weblink: string };
    };
    const plist = JSON.parse(
      execFileSync("plutil", ["-convert", "json", "-o", "-", join(root, "dist", "info.plist")], {
        encoding: "utf8"
      })
    ) as {
      objects: Array<{ type: string; config: { keyword?: string } }>;
    };
    const keywords = plist.objects
      .filter((object) => object.type === "alfred.workflow.input.keyword")
      .map((object) => object.config.keyword);
    expect(keywords).toEqual([
      configuration.keywords.dailyNote,
      configuration.keywords.dailyLog,
      configuration.keywords.weblink
    ]);
  });

  onMac("exercises the compiled SOCKS5 curl transport without external runtimes", () => {
    const cache = mkdtempSync(join(tmpdir(), "alfred-capacities-test-"));
    try {
      const output = execFileSync(
        "osascript",
        ["-l", "JavaScript", join(root, "dist", "daily-log.js"), "Smoke entry"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            CAPACITIES_API_TOKEN: "cap-api-test",
            CAPACITIES_SOCKS5_PROXY: "socks5h://127.0.0.1:9",
            CAPACITIES_CONNECT_TIMEOUT: "1",
            CAPACITIES_REQUEST_TIMEOUT: "2",
            CAPACITIES_RETRIES: "0",
            alfred_workflow_cache: cache
          }
        }
      );
      expect(output).toContain("Unable to reach Capacities");
      expect(output).toContain("127.0.0.1 port 9");
      expect(output).not.toContain("cap-api-test");
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("packages the expected workflow files", () => {
    execFileSync("bash", [join(root, "package.sh")], { cwd: root });
    const archive = join(root, "Capacities_Quick_Capture.alfredworkflow");
    const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(names).toEqual(
      [
        "capacities-worker.js",
        "capture.js",
        "daily-log.js",
        "daily-note.js",
        "icon.png",
        "info.plist"
      ].sort()
    );
  });
});
