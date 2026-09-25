// src/entries/setup.ts — entry point for `cap:setup` in Alfred.
// Bundles to dist/setup.js as a self-contained JXA script.

import { initJxaBridge, readEnv, saveConfig, nsLog, showAlert } from '../jxa-utils.ts';
import { makeJxaTransport } from '../transport/jxa.ts';
import { setup } from '../flows.ts';

export function run(_argv: string[]): string {
    initJxaBridge();

    const token = readEnv('CAPACITIES_TOKEN');
    if (!token) {
        const err = 'CAPACITIES_TOKEN is missing. Please configure it in Alfred workflow settings.';
        showAlert('Capacities Setup Error', err, true);
        return 'ERROR: ' + err;
    }

    const transport = makeJxaTransport({ token });

    try {
        const result = setup(transport);
        saveConfig('CAPACITIES_LOG_STRUCTURE_ID', result.structureId);
        saveConfig('CAPACITIES_LOG_STRUCTURE_TITLE', result.structureTitle);
        saveConfig('CAPACITIES_SPACE_TITLE', result.space.title || '');
        const msg = `Space "${result.space.title || result.space.id}" is ready! Captures will save to "${result.structureTitle}".`;
        showAlert('Capacities Setup Complete', msg, false);
        return msg;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nsLog('ERROR: ' + msg);
        showAlert('Capacities Setup Error', msg, true);
        const firstLine = msg.split('\n')[0];
        return 'ERROR: ' + firstLine;
    }
}

// Ensure run is available globally to osascript
(typeof globalThis !== 'undefined' ? globalThis : this as any).run = run;
