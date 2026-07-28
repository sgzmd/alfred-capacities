import { validateSocksProxy } from "./url";

export interface WorkflowConfig {
  apiToken: string;
  paragraphCount: number;
  proxy?: string;
  connectTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  retries: number;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Expected a whole number between ${min} and ${max}.`);
  }
  const number = Number(value);
  if (number < min || number > max) {
    throw new Error(`Expected a whole number between ${min} and ${max}.`);
  }
  return number;
}

export function readParagraphCount(value: string | undefined): number {
  return boundedInteger(value, 3, 0, 20);
}

export function readWorkflowConfig(env: Record<string, string | undefined>): WorkflowConfig {
  const apiToken = (env.CAPACITIES_API_TOKEN || "").trim();
  if (!apiToken) {
    throw new Error("Capacities API token is missing.");
  }
  if (!apiToken.startsWith("cap-api-")) {
    throw new Error("Use a new space-scoped Capacities token beginning with cap-api-.");
  }

  const proxy = validateSocksProxy(env.CAPACITIES_SOCKS5_PROXY || "");
  return {
    apiToken,
    paragraphCount: readParagraphCount(env.CAPACITIES_PARAGRAPH_COUNT),
    ...(proxy ? { proxy } : {}),
    connectTimeoutSeconds: boundedInteger(env.CAPACITIES_CONNECT_TIMEOUT, 10, 1, 120),
    requestTimeoutSeconds: boundedInteger(env.CAPACITIES_REQUEST_TIMEOUT, 45, 1, 300),
    retries: boundedInteger(env.CAPACITIES_RETRIES, 2, 0, 5)
  };
}
