import { execFileSync } from 'node:child_process';
import type { Transport, TransportRequest, TransportResponse } from './types.ts';

export const API_VERSION = '2026-01-01';

const MIN_INTERVAL_MS = 300;
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 5;
const BACKOFF_MS = [2000, 5000, 10000, 20000, 35000];

export interface NodeTransportOptions {
    token: string;
    baseUrl?: string;
}

export function makeNodeTransport({ token, baseUrl }: NodeTransportOptions): Transport {
    if (!token) throw new Error('nodeTransport: token is required');
    const base = (baseUrl || 'https://api.capacities.io').replace(/\/$/, '');
    let lastFireAt = 0;

    return function transport(req: TransportRequest): TransportResponse {
        const url = buildUrl(base, req.path, req.query);
        const args = [
            '-sS',
            '-o', '-',
            '-w', '\n__HTTP_STATUS__:%{http_code}',
            '-X', req.method,
            '-H', `Authorization: Bearer ${token}`,
            '-H', `Capacities-API-Version: ${API_VERSION}`,
            '-H', 'Accept: application/json',
        ];
        if (req.body !== undefined) {
            args.push('-H', 'Content-Type: application/json');
            args.push('--data-binary', JSON.stringify(req.body));
        }
        args.push(url);

        for (let attempt = 0; ; attempt++) {
            paceSync();
            const res = sendOnce(args);
            if (attempt >= MAX_RETRIES || !RETRY_STATUSES.has(res.status)) return res;
            sleepSync(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        }
    };

    function paceSync(): void {
        const now = Date.now();
        const wait = MIN_INTERVAL_MS - (now - lastFireAt);
        if (wait > 0) sleepSync(wait);
        lastFireAt = Date.now();
    }
}

function sendOnce(args: string[]): TransportResponse {
    let stdout: string;
    try {
        stdout = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    } catch (e: unknown) {
        const err = e as { stdout?: string; message: string };
        stdout = String(err.stdout || '') || `curl error: ${err.message}`;
        return { status: 0, text: stdout };
    }
    const marker = '\n__HTTP_STATUS__:';
    const at = stdout.lastIndexOf(marker);
    if (at < 0) return { status: 0, text: stdout };
    const status = parseInt(stdout.slice(at + marker.length), 10);
    return { status, text: stdout.slice(0, at) };
}

function sleepSync(ms: number): void {
    execFileSync(
        process.execPath,
        ['-e', `setTimeout(() => process.exit(0), ${ms})`],
        { stdio: 'ignore' },
    );
}

export function buildUrl(
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
