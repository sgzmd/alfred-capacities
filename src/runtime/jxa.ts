import type { WorkflowConfig } from "../core/config";
import { API_VERSION } from "../core/sdk-contract";
import type { HttpRequest, HttpResponse, HttpTransport } from "../core/types";

export function initializeJxa(): void {
  ObjC.import("Foundation");
}

function currentApplication(): any {
  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  return app;
}

export function environment(): Record<string, string | undefined> {
  return ObjC.deepUnwrap($.NSProcessInfo.processInfo.environment) as Record<
    string,
    string | undefined
  >;
}

export function notify(title: string, message: string, subtitle?: string): void {
  const options: Record<string, string> = { withTitle: title };
  if (subtitle) {
    options.subtitle = subtitle;
  }
  currentApplication().displayNotification(message, options);
}

export function workflowDirectory(): string {
  return $.NSFileManager.defaultManager.currentDirectoryPath.js as string;
}

export function joinPath(left: string, right: string): string {
  return `${left.replace(/\/+$/, "")}/${right.replace(/^\/+/, "")}`;
}

export function ensureDirectory(path: string): void {
  const manager = $.NSFileManager.defaultManager;
  const error = Ref();
  const ok = manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    path,
    true,
    $(),
    error
  );
  if (!ok) {
    const detail = error[0] ? error[0].localizedDescription.js : "unknown error";
    throw new Error(`Unable to create workflow cache: ${detail}`);
  }
}

export function uniqueId(): string {
  return $.NSUUID.UUID.UUIDString.js as string;
}

export function writeText(path: string, value: string): void {
  const error = Ref();
  const ok = $(value).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, error);
  if (!ok) {
    const detail = error[0] ? error[0].localizedDescription.js : "unknown error";
    throw new Error(`Unable to write workflow data: ${detail}`);
  }
}

export function readText(path: string): string {
  const error = Ref();
  const value = $.NSString.stringWithContentsOfFileEncodingError(
    path,
    $.NSUTF8StringEncoding,
    error
  );
  if (!value) {
    const detail = error[0] ? error[0].localizedDescription.js : "unknown error";
    throw new Error(`Unable to read workflow data: ${detail}`);
  }
  return value.js as string;
}

export function removePath(path: string): void {
  $.NSFileManager.defaultManager.removeItemAtPathError(path, $());
}

function task(
  path: string,
  args: string[],
  capture = false
): { status: number; stdout: string; stderr: string } {
  const process = $.NSTask.alloc.init;
  process.launchPath = path;
  process.arguments = args;
  const stdout = capture ? $.NSPipe.pipe : null;
  const stderr = capture ? $.NSPipe.pipe : null;
  if (capture) {
    process.standardOutput = stdout;
    process.standardError = stderr;
  } else {
    process.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
    process.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  }
  process.launch;
  if (!capture) {
    return { status: 0, stdout: "", stderr: "" };
  }
  process.waitUntilExit;
  const stdoutData = stdout.fileHandleForReading.readDataToEndOfFile;
  const stderrData = stderr.fileHandleForReading.readDataToEndOfFile;
  const decode = (data: any): string =>
    $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)?.js || "";
  return {
    status: process.terminationStatus,
    stdout: decode(stdoutData),
    stderr: decode(stderrData)
  };
}

export function setPrivatePermissions(path: string, directory = false): void {
  const mode = directory ? "700" : "600";
  const result = task("/bin/chmod", [mode, path], true);
  if (result.status !== 0) {
    throw new Error(`Unable to secure workflow data: ${result.stderr.trim()}`);
  }
}

export function launchWorker(workerPath: string, jobPath: string): void {
  task("/usr/bin/osascript", ["-l", "JavaScript", workerPath, jobPath]);
}

export function sleep(milliseconds: number): void {
  currentApplication().delay(milliseconds / 1000);
}

function escapeCurlConfig(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error("Configuration contains an invalid newline.");
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseHeaders(raw: string): Record<string, string> {
  const blocks = raw.trim().split(/\r?\n\r?\n/);
  const lines = (blocks[blocks.length - 1] || "").split(/\r?\n/).slice(1);
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
  }
  return headers;
}

interface CurlFiles {
  config: string;
  body: string;
  response: string;
  headers: string;
}

function curlFiles(requestDirectory: string): CurlFiles {
  return {
    config: joinPath(requestDirectory, "curl.conf"),
    body: joinPath(requestDirectory, "body.json"),
    response: joinPath(requestDirectory, "response.txt"),
    headers: joinPath(requestDirectory, "headers.txt")
  };
}

function writeCurlConfig(request: HttpRequest, config: WorkflowConfig, files: CurlFiles): void {
  if (request.body !== undefined) {
    writeText(files.body, JSON.stringify(request.body));
    setPrivatePermissions(files.body);
  }

  const lines = [
    "silent",
    "show-error",
    `request = "${request.method}"`,
    `url = "${escapeCurlConfig(`https://api.capacities.io${request.path}`)}"`,
    `header = "Authorization: Bearer ${escapeCurlConfig(config.apiToken)}"`,
    `header = "X-Capacities-Api-Version: ${API_VERSION}"`,
    'header = "Accept: application/json"',
    ...(request.body === undefined
      ? []
      : [
          'header = "Content-Type: application/json"',
          `data-binary = "@${escapeCurlConfig(files.body)}"`
        ]),
    `connect-timeout = "${config.connectTimeoutSeconds}"`,
    `max-time = "${config.requestTimeoutSeconds}"`,
    `output = "${escapeCurlConfig(files.response)}"`,
    `dump-header = "${escapeCurlConfig(files.headers)}"`,
    'write-out = "%{http_code}"',
    ...(config.proxy ? [`proxy = "${escapeCurlConfig(config.proxy)}"`] : [])
  ];
  writeText(files.config, `${lines.join("\n")}\n`);
  setPrivatePermissions(files.config);
}

function readCurlResponse(files: CurlFiles): HttpResponse {
  const result = task("/usr/bin/curl", ["--config", files.config], true);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `curl exited with status ${result.status}`);
  }
  const status = Number(result.stdout.trim());
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error("curl returned an invalid HTTP status.");
  }
  const manager = $.NSFileManager.defaultManager;
  const body = manager.fileExistsAtPath(files.response) ? readText(files.response) : "";
  const rawHeaders = manager.fileExistsAtPath(files.headers) ? readText(files.headers) : "";
  return { status, headers: parseHeaders(rawHeaders), body };
}

export function createCurlTransport(config: WorkflowConfig, cacheDirectory: string): HttpTransport {
  return (request): HttpResponse => {
    const requestDirectory = joinPath(cacheDirectory, `request-${uniqueId()}`);
    ensureDirectory(requestDirectory);
    setPrivatePermissions(requestDirectory, true);
    const files = curlFiles(requestDirectory);
    try {
      writeCurlConfig(request, config, files);
      return readCurlResponse(files);
    } finally {
      removePath(requestDirectory);
    }
  };
}

export function tryAcquireLock(path: string): boolean {
  const manager = $.NSFileManager.defaultManager;
  const error = Ref();
  const ok = manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    path,
    false,
    $(),
    error
  );
  if (ok) {
    setPrivatePermissions(path, true);
  }
  return Boolean(ok);
}
