// transport/node.js — synchronous Node transport. Uses execFileSync('curl',
// [...args]) so the call is truly sync (matches JXA's blocking transport) and
// the args are passed as argv — no shell, no quoting, no escaping needed.
//
// Used by scripts/e2e.js. Not loaded under JXA.

'use strict';

const { execFileSync } = require('node:child_process');

const API_VERSION = '2026-01-01';

// Cloudflare (error code 1015) rate-limits after a burst. Two lines of defence:
//   - client-side pacing: keep at least MIN_INTERVAL_MS between requests
//   - retry on 429/503 with backoff, up to MAX_RETRIES
const MIN_INTERVAL_MS = 200;
const RETRY_STATUSES = new Set([429, 503]);
const MAX_RETRIES = 5;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

function makeNodeTransport({ token, baseUrl }) {
    if (!token) throw new Error('nodeTransport: token is required');
    baseUrl = (baseUrl || 'https://api.capacities.io').replace(/\/$/, '');
    let lastFireAt = 0; // wall-clock ms of most recent send

    return function transport(req) {
        const url = buildUrl(baseUrl, req.path, req.query);
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

    function paceSync() {
        const now = Date.now();
        const wait = MIN_INTERVAL_MS - (now - lastFireAt);
        if (wait > 0) sleepSync(wait);
        lastFireAt = Date.now();
    }
}

function sendOnce(args) {
    let stdout;
    try {
        stdout = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    } catch (e) {
        stdout = String(e.stdout || '') || `curl error: ${e.message}`;
        return { status: 0, text: stdout };
    }
    const marker = '\n__HTTP_STATUS__:';
    const at = stdout.lastIndexOf(marker);
    if (at < 0) return { status: 0, text: stdout };
    const status = parseInt(stdout.slice(at + marker.length), 10);
    return { status, text: stdout.slice(0, at) };
}

function sleepSync(ms) {
    // Synchronous sleep — Node has no built-in; spawning a short-lived child
    // that just times out is the simplest zero-dep way that works in every
    // process configuration.
    execFileSync(
        process.execPath,
        ['-e', `setTimeout(() => process.exit(0), ${ms})`],
        { stdio: 'ignore' },
    );
}

function buildUrl(base, path, query) {
    let url = base + path;
    if (query) {
        const pairs = [];
        for (const k of Object.keys(query)) {
            if (query[k] == null) continue;
            pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])));
        }
        if (pairs.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + pairs.join('&');
    }
    return url;
}

module.exports = { makeNodeTransport, API_VERSION };
