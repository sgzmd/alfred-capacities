// src/entries/capture.ts — entry point for `cap <note>` in Alfred.
// Bundles to dist/send_to_daily_note.js as a self-contained JXA script.

import { initJxaBridge, readEnv, nsLog } from '../jxa-utils.ts';
import { makeJxaTransport } from '../transport/jxa.ts';
import { capture } from '../flows.ts';

export function run(argv: string[]): string {
    initJxaBridge();

    const text = (argv[0] || '').trim();
    if (!text) return 'ERROR: Note content is empty.';

    const token = readEnv('CAPACITIES_TOKEN');
    const structureId = readEnv('CAPACITIES_LOG_STRUCTURE_ID');
    if (!token) return 'ERROR: CAPACITIES_TOKEN missing. Configure it in the workflow settings.';
    if (!structureId) return 'ERROR: Not set up. Run `cap:setup` in Alfred first.';

    const transport = makeJxaTransport({ token });

    try {
        const result = capture(transport, { text, structureId });
        if (result.embedded) {
            return 'Note added successfully!';
        } else {
            nsLog('capture warning — ' + (result.warning || 'unknown'));
            return 'Note saved, but not embedded in daily note (see logs).';
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nsLog('ERROR: ' + msg);
        return 'ERROR: ' + msg;
    }
}

// Ensure run is available globally to osascript
(typeof globalThis !== 'undefined' ? globalThis : this as any).run = run;
