import { CapacitiesApi, CapacitiesError } from "../core/api";
import { readWorkflowConfig } from "../core/config";
import { validateWeblinkJob, saveWeblink } from "../core/workflows";
import { canonicalizeWebUrl } from "../core/url";
import {
  createCurlTransport,
  environment,
  initializeJxa,
  joinPath,
  notify,
  readText,
  removePath,
  sleep,
  tryAcquireLock
} from "./jxa";

function hash(value: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function safeMessage(error: unknown, secrets: string[]): string {
  let message =
    error instanceof CapacitiesError || error instanceof Error ? error.message : "Unknown Capacities error.";
  for (const secret of secrets) {
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }
  return message.slice(0, 240);
}

export function workerRun(argv: string[]): string {
  initializeJxa();
  const jobPath = argv[0];
  if (!jobPath) {
    return "ERROR: Missing Weblink job.";
  }

  let lockPath: string | undefined;
  let token = "";
  let proxy = "";
  try {
    const env = environment();
    const config = readWorkflowConfig(env);
    token = config.apiToken;
    proxy = config.proxy || "";
    const job = validateWeblinkJob(JSON.parse(readText(jobPath)) as unknown);
    const cache = env.alfred_workflow_cache || joinPath("/tmp", "cc.kirillov.alfred-capacities");
    lockPath = joinPath(cache, `lock-${hash(canonicalizeWebUrl(job.url))}`);
    if (!tryAcquireLock(lockPath)) {
      notify("Capacities Weblink", "This page is already being checked.", job.title);
      return "Already processing";
    }

    const api = new CapacitiesApi(createCurlTransport(config, cache), {
      retries: config.retries,
      sleep
    });
    const result = saveWeblink(api, job);
    if (result.outcome === "existing") {
      notify("Already in Capacities", "No duplicate Weblink was created.", result.title);
      return "Already exists";
    }
    notify("Saved to Capacities", "Weblink and page excerpt added.", result.title);
    return "Created";
  } catch (error) {
    const message = safeMessage(error, [token, proxy]);
    notify("Capacities Weblink Error", message);
    return `ERROR: ${message}`;
  } finally {
    if (lockPath) {
      removePath(lockPath);
    }
    removePath(jobPath);
  }
}
