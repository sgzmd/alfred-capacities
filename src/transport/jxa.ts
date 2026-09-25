// src/transport/jxa.ts — JXA transport using NSTask + /usr/bin/curl.
// Synchronous, avoids async microtask hang under JXA runloop.

import type { Transport, TransportRequest, TransportResponse } from './types.ts';

// ObjC bridge globals injected by JXA runtime
declare const $: any;

export const API_VERSION = '2026-01-01';
const STATUS_MARKER = '__HTTP_STATUS__:';
const MIN_INTERVAL_MS = 300;
const RETRY_STATUSES: Record<number, boolean> = { 429: true, 503: true };
const MAX_RETRIES = 5;
const BACKOFF_MS = [2000, 5000, 10000, 20000, 35000];

export interface JxaTransportOptions {
    token: string;
    baseUrl?: string;
}

export function makeJxaTransport(opts: JxaTransportOptions): Transport {
    const token = opts.token;
    const baseUrl = (opts.baseUrl || 'https://api.capacities.io').replace(/\/$/, '');
    if (!token) throw new Error('jxaTransport: token is required');
    let lastFireAt = 0;

    return function transport(req: TransportRequest): TransportResponse {
        const url = buildUrl(baseUrl, req.path, req.query);
        const args = [
            '-sS',
            '-o', '-',
            '-w', STATUS_MARKER + '%{http_code}',
            '-X', req.method,
            '-H', 'Authorization: Bearer ' + token,
            '-H', 'Capacities-API-Version: ' + API_VERSION,
            '-H', 'Accept: application/json',
            '--max-time', '60',
        ];
        if (req.body !== undefined) {
            args.push('-H', 'Content-Type: application/json');
            args.push('--data-binary', JSON.stringify(req.body));
        }
        args.push(url);

        for (let attempt = 0; ; attempt++) {
            const wait = MIN_INTERVAL_MS - (Date.now() - lastFireAt);
            if (wait > 0) $.NSThread.sleepForTimeInterval(wait / 1000);
            const res = sendOnce(args);
            lastFireAt = Date.now();
            if (attempt >= MAX_RETRIES || !RETRY_STATUSES[res.status]) return res;
            const ms = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
            $.NSThread.sleepForTimeInterval(ms / 1000);
        }
    };
}

function sendOnce(args: string[]): TransportResponse {
    const out = runTaskCapture('/usr/bin/curl', args);
    const at = out.lastIndexOf(STATUS_MARKER);
    if (at < 0) return { status: 0, text: out };
    const status = parseInt(out.slice(at + STATUS_MARKER.length), 10);
    return { status: status, text: out.slice(0, at) };
}

function runTaskCapture(launchPath: string, argsArray: string[]): string {
    const task = $.NSTask.alloc.init;
    task.launchPath = launchPath;

    const nsargs = $.NSMutableArray.alloc.init;
    for (const a of argsArray) nsargs.addObject($(a));
    task.arguments = nsargs;

    const pipe = $.NSPipe.pipe;
    task.standardOutput = pipe;
    task.standardError = pipe;

    task.launch;
    task.waitUntilExit;

    const data = pipe.fileHandleForReading.readDataToEndOfFile;
    const nsstr = $.NSString.alloc.initWithDataEncoding(data, 4 /* NSUTF8StringEncoding */);
    return nsstr.isNil() ? '' : String(nsstr.js);
}

function buildUrl(
    base: string,
    path: string,
    query?: Record<string, string | number | boolean | null | undefined>,
): string {
    let url = base + path;
    if (query) {
        const pairs: string[] = [];
        for (const k of Object.keys(query)) {
            if (query[k] == null) continue;
            pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])));
        }
        if (pairs.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&');
    }
    return url;
}
