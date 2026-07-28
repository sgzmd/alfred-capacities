import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      execFileSync(
        "osascript",
        ["-l", "JavaScript", join(root, "dist", "capacities-worker.js")],
        { encoding: "utf8" }
      ).trim()
    ).toBe("ERROR: Missing Weblink job.");
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
