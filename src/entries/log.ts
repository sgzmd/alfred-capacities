// src/entries/log.ts — entry point for `cap:log <range>` Alfred Script Filter.
// Bundles to dist/log.js as a self-contained JXA script.

import { initJxaBridge, readEnv, formatWhen, alfredError, alfredEmpty } from '../jxa-utils.ts';
import { parseRangeExpression } from '../runner.ts';
import { makeJxaTransport } from '../transport/jxa.ts';
import { listInRange } from '../flows.ts';

export function run(argv: string[]): string {
    initJxaBridge();

    const token = readEnv('CAPACITIES_TOKEN');
    const structureId = readEnv('CAPACITIES_LOG_STRUCTURE_ID');
    if (!token) return alfredError('CAPACITIES_TOKEN missing', 'Set it in workflow settings.');
    if (!structureId) return alfredError('Not set up', 'Run `cap:setup` in Alfred first.');

    let range;
    try {
        range = parseRangeExpression(argv[0], new Date());
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return alfredError('Bad range', msg);
    }

    const transport = makeJxaTransport({ token });

    let objects;
    try {
        objects = listInRange(transport, {
            structureId,
            from: range.from,
            to: range.to,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return alfredError('API error', msg);
    }

    if (objects.length === 0) {
        return alfredEmpty(range.from, range.to);
    }

    const items = objects.map((o) => {
        const when = o.createdAt ? formatWhen(o.createdAt) : '';
        const title = o.title || '(untitled)';
        const deepLink = o.deepLink || o.url || '';
        return {
            uid: o.id,
            title,
            subtitle: when + (deepLink ? '  ⏎ open in Capacities' : ''),
            arg: deepLink || o.id,
            variables: { object_id: o.id },
        };
    });
    return JSON.stringify({ items });
}

// Ensure run is available globally to osascript
(typeof globalThis !== 'undefined' ? globalThis : this as any).run = run;
