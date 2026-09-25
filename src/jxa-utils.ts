// src/jxa-utils.ts — JXA runtime helpers for Alfred scripts.

declare const $: any;
declare const ObjC: any;
declare const Application: any;

export function initJxaBridge(): void {
    if (typeof ObjC !== 'undefined') {
        ObjC.import('Foundation');
    }
}

export function readEnv(name: string): string | undefined {
    try {
        const v = $.NSProcessInfo.processInfo.environment.objectForKey(name);
        if (!v || v.isNil()) return undefined;
        return String(v.js);
    } catch {
        return undefined;
    }
}

export function saveConfig(key: string, value: string): void {
    try {
        const alfred = Application('Alfred 5');
        alfred.setConfiguration(key, {
            toValue: String(value),
            inWorkflow: 'cc.kirillov.alfred-capacities',
        });
    } catch (e: unknown) {
        nsLog(`Failed to saveConfig ${key}: ${e}`);
    }
}

export function showAlert(title: string, message: string, isError: boolean = false): void {
    try {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;
        app.displayAlert(title, {
            message: message,
            as: isError ? 'critical' : 'informational',
        });
    } catch (e: unknown) {
        nsLog(`displayAlert failed: ${e}`);
    }
}

export function nsLog(msg: string): void {
    try {
        $.NSLog(`alfred-capacities: ${msg}`);
    } catch {
        // Ignored outside JXA
    }
}

export function formatWhen(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${wk} ${hh}:${mm}`;
}

export function alfredError(title: string, subtitle: string): string {
    return JSON.stringify({
        items: [{
            title,
            subtitle,
            valid: false,
        }],
    });
}

export function alfredEmpty(from: Date, to: Date): string {
    return JSON.stringify({
        items: [{
            title: 'No captures in range',
            subtitle: `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
            valid: false,
        }],
    });
}
