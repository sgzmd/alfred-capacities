// transport/jxa.js — JXA transport. Spawns curl via NSTask with an argv array
// (no shell, no quoting) and reads its output. This mirrors the Node transport
// exactly and sidesteps two known-flaky JXA bridge patterns: NSURLSession
// completion-handler blocks and NSURLConnection Ref() out-parameters.
//
// Loaded into globalThis by JXA entry scripts via loadModule(). Not exercised
// by unit tests (mockTransport covers the contract).

(function (root) {
    'use strict';

    const API_VERSION = '2026-01-01';
    const STATUS_MARKER = '__HTTP_STATUS__:';
    // Two lines of defence against Cloudflare's rate limit (error code 1015):
    //   - keep at least MIN_INTERVAL_MS between requests
    //   - retry 429/503 with backoff, up to MAX_RETRIES
    const MIN_INTERVAL_MS = 200;
    const RETRY_STATUSES = { 429: true, 503: true };
    const MAX_RETRIES = 5;
    const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

    function makeJxaTransport(opts) {
        const token = opts.token;
        const baseUrl = (opts.baseUrl || 'https://api.capacities.io').replace(/\/$/, '');
        if (!token) throw new Error('jxaTransport: token is required');
        let lastFireAt = 0;

        return function transport(req) {
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

    function sendOnce(args) {
        const out = runTaskCapture('/usr/bin/curl', args);
        const at = out.lastIndexOf(STATUS_MARKER);
        if (at < 0) return { status: 0, text: out };
        const status = parseInt(out.slice(at + STATUS_MARKER.length), 10);
        return { status: status, text: out.slice(0, at) };
    }

    function runTaskCapture(launchPath, argsArray) {
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

    const api = { makeJxaTransport, API_VERSION };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.jxaTransport = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
