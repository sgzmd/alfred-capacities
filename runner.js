// runner.js — pure, synchronous. Composes ops against a transport.
//
// Consumed by Node (require) and by JXA (eval into globalThis via loadModule).
// Everything is sync — async/await is unusable under JXA because the runloop
// doesn't drain microtasks between yields.

(function (root) {
    'use strict';

    class ApiError extends Error {
        constructor(opName, status, body) {
            super(`${opName} failed with HTTP ${status}: ${truncate(body, 400)}`);
            this.name = 'ApiError';
            this.opName = opName;
            this.status = status;
            this.body = body;
        }
    }

    function truncate(s, n) {
        s = String(s || '');
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    // run(op, input, transport) → parsed value, or throws.
    //
    // Every op has { name, build(input) → {method, path, body?, query?}, parse(text) → any }.
    // Transport is a synchronous function {method, path, body?, query?} → {status, text}.
    function run(op, input, transport) {
        const req = op.build(input || {});
        const res = transport(req);
        if (!res || typeof res.status !== 'number') {
            throw new Error(`${op.name}: transport returned malformed response`);
        }
        if (res.status < 200 || res.status >= 300) {
            throw new ApiError(op.name, res.status, res.text);
        }
        // 204 No Content and other empty bodies pass through as null.
        if (!res.text || res.text.length === 0) return op.parse ? op.parse('') : null;
        try {
            return op.parse ? op.parse(res.text) : res.text;
        } catch (e) {
            throw new Error(`${op.name}: failed to parse response — ${e.message}: ${truncate(res.text, 200)}`);
        }
    }

    // parseRangeExpression(expr, now) → { from: Date, to: Date }
    //
    // Grammar:
    //   "today"                    → midnight today .. now
    //   "week"                     → last 7 days
    //   "N"       (positive int)   → last N days
    //   "YYYY-MM-DD..YYYY-MM-DD"   → explicit range, inclusive at start, exclusive at end + 1d
    //   ""       / undefined       → last 7 days (same as "week")
    function parseRangeExpression(expr, now) {
        now = now || new Date();
        const s = String(expr == null ? '' : expr).trim().toLowerCase();
        if (s === '' || s === 'week') return daysBack(now, 7);
        if (s === 'today') {
            const from = new Date(now);
            from.setUTCHours(0, 0, 0, 0);
            return { from, to: new Date(now) };
        }
        if (/^\d+$/.test(s)) {
            const n = parseInt(s, 10);
            if (n <= 0 || n > 3650) throw new Error(`range: ${expr} out of bounds`);
            return daysBack(now, n);
        }
        const iso = s.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
        if (iso) {
            const from = new Date(iso[1] + 'T00:00:00Z');
            const to = new Date(iso[2] + 'T00:00:00Z');
            to.setUTCDate(to.getUTCDate() + 1); // inclusive end day
            if (isNaN(from) || isNaN(to)) throw new Error(`range: ${expr} unparseable`);
            if (to <= from) throw new Error(`range: ${expr} — end before start`);
            return { from, to };
        }
        throw new Error(`range: cannot parse ${JSON.stringify(expr)}`);
    }

    function daysBack(now, n) {
        const from = new Date(now);
        from.setUTCDate(from.getUTCDate() - n);
        return { from, to: new Date(now) };
    }

    // filterByDate(objects, {from, to}) — from inclusive, to exclusive; newest first.
    function filterByDate(objects, range) {
        const from = +range.from;
        const to = +range.to;
        return (objects || [])
            .map(o => ({ o, t: +new Date(o.createdAt) }))
            .filter(({ t }) => !isNaN(t) && t >= from && t < to)
            .sort((a, b) => b.t - a.t)
            .map(({ o }) => o);
    }

    const api = { run, ApiError, parseRangeExpression, filterByDate, truncate };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.runner = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
