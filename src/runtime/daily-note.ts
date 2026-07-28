import { CapacitiesApi } from "../core/api";
import { readWorkflowConfig } from "../core/config";
import { formatDailyLog } from "../core/markdown";
import { createCurlTransport, environment, initializeJxa, joinPath, sleep } from "./jxa";

function sendDailyNote(argv: string[], dailyLog: boolean): string {
  initializeJxa();
  const input = argv[0] || "";
  if (!input.trim()) {
    return "ERROR: Note content is empty.";
  }
  try {
    const env = environment();
    const config = readWorkflowConfig(env);
    const cache = env.alfred_workflow_cache || joinPath("/tmp", "cc.kirillov.alfred-capacities");
    const api = new CapacitiesApi(createCurlTransport(config, cache), {
      retries: config.retries,
      sleep
    });
    api.appendDailyNote(dailyLog ? formatDailyLog(input) : input);
    return "Note added successfully!";
  } catch (error) {
    const env = environment();
    const secrets = [env.CAPACITIES_API_TOKEN || "", env.CAPACITIES_SOCKS5_PROXY || ""];
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of secrets) {
      if (secret) {
        message = message.split(secret).join("[redacted]");
      }
    }
    return `ERROR: ${message}`;
  }
}

export function dailyNoteRun(argv: string[]): string {
  return sendDailyNote(argv, false);
}

export function dailyLogRun(argv: string[]): string {
  return sendDailyNote(argv, true);
}
