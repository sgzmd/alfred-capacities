import type { CapacitiesApi } from "./api";
import type { WeblinkJob, WeblinkResult } from "./types";
import { canonicalizeWebUrl } from "./url";

export function validateWeblinkJob(value: unknown): WeblinkJob {
  if (!value || typeof value !== "object") {
    throw new Error("Weblink job is invalid.");
  }
  const candidate = value as Partial<WeblinkJob>;
  if (
    candidate.kind !== "weblink" ||
    typeof candidate.title !== "string" ||
    typeof candidate.url !== "string" ||
    typeof candidate.markdown !== "string"
  ) {
    throw new Error("Weblink job is invalid.");
  }
  canonicalizeWebUrl(candidate.url);
  return {
    kind: "weblink",
    title: candidate.title.trim() || candidate.url,
    url: candidate.url,
    markdown: candidate.markdown
  };
}

export function saveWeblink(api: CapacitiesApi, job: WeblinkJob): WeblinkResult {
  const existing = api.findWeblink(job.url, job.title);
  if (existing) {
    return { outcome: "existing", ...existing };
  }
  return { outcome: "created", ...api.createWeblink(job.url, job.title, job.markdown) };
}
