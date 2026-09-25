// src/runner.ts — pure, synchronous. Composes ops against a transport.
//
// Strictly synchronous — async/await is unusable under JXA because the runloop
// doesn't drain microtasks between yields.

import type { Op, DateRange } from './types.ts';
import type { Transport } from './transport/types.ts';

export class ApiError extends Error {
    readonly opName: string;
    readonly status: number;
    readonly body: string;

    constructor(opName: string, status: number, body: string) {
        super(`${opName} failed with HTTP ${status}: ${truncate(body, 400)}`);
        this.name = 'ApiError';
        this.opName = opName;
        this.status = status;
        this.body = body;
    }
}

export function truncate(s: unknown, n: number): string {
    const str = String(s == null ? '' : s);
    return str.length > n ? str.slice(0, n) + '…' : str;
}

// run(op, input, transport) → parsed value, or throws.
export function run<TInput, TOutput>(
    op: Op<TInput, TOutput>,
    input: TInput,
    transport: Transport,
): TOutput {
    const req = op.build(input);
    const res = transport(req);
    if (!res || typeof res.status !== 'number') {
        throw new Error(`${op.name}: transport returned malformed response`);
    }
    if (res.status < 200 || res.status >= 300) {
        throw new ApiError(op.name, res.status, res.text);
    }
    // 204 No Content and other empty bodies pass through as null/empty
    if (!res.text || res.text.length === 0) {
        return op.parse ? op.parse('') : (null as unknown as TOutput);
    }
    try {
        return op.parse ? op.parse(res.text) : (res.text as unknown as TOutput);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`${op.name}: failed to parse response — ${msg}: ${truncate(res.text, 200)}`);
    }
}

// parseRangeExpression(expr, now) → { from: Date, to: Date }
//
// Grammar:
//   "today"                    → midnight today UTC .. now
//   "week"                     → last 7 days
//   "N"       (positive int)   → last N days (max 3650)
//   "YYYY-MM-DD..YYYY-MM-DD"   → explicit range, inclusive at start, exclusive at end + 1d
//   ""       / undefined       → last 7 days (same as "week")
export function parseRangeExpression(expr?: string | null, now?: Date): DateRange {
    const current = now ? new Date(now.getTime()) : new Date();
    const s = String(expr == null ? '' : expr).trim().toLowerCase();

    if (s === '' || s === 'week') return daysBack(current, 7);

    if (s === 'today') {
        const from = new Date(current.getTime());
        from.setUTCHours(0, 0, 0, 0);
        return { from, to: new Date(current.getTime()) };
    }

    if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        if (n <= 0 || n > 3650) throw new Error(`range: ${expr} out of bounds`);
        return daysBack(current, n);
    }

    const iso = s.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
    if (iso) {
        const fromStr = iso[1];
        const toStr = iso[2];
        const from = new Date(fromStr + 'T00:00:00.000Z');
        const to = new Date(toStr + 'T00:00:00.000Z');
        to.setUTCDate(to.getUTCDate() + 1); // inclusive end day

        // Validate that calendar date matched (e.g. catch 2026-02-31)
        if (isNaN(from.getTime()) || isNaN(to.getTime())) {
            throw new Error(`range: ${expr} unparseable`);
        }
        if (from.toISOString().slice(0, 10) !== fromStr) {
            throw new Error(`range: ${expr} unparseable date component`);
        }
        if (to <= from) throw new Error(`range: ${expr} — end before start`);
        return { from, to };
    }

    throw new Error(`range: cannot parse ${JSON.stringify(expr)}`);
}

function daysBack(now: Date, n: number): DateRange {
    const from = new Date(now.getTime());
    from.setUTCDate(from.getUTCDate() - n);
    return { from, to: new Date(now.getTime()) };
}

// filterByDate(objects, {from, to}) — from inclusive, to exclusive; newest first.
export function filterByDate<T extends { createdAt?: string }>(objects: T[], range: DateRange): T[] {
    const from = range.from.getTime();
    const to = range.to.getTime();
    return (objects || [])
        .map(o => ({ o, t: o.createdAt ? new Date(o.createdAt).getTime() : NaN }))
        .filter(({ t }) => !isNaN(t) && t >= from && t < to)
        .sort((a, b) => b.t - a.t)
        .map(({ o }) => o);
}
