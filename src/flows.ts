// src/flows.ts — pure, synchronous. Named compositions of ops.

import { run, filterByDate } from './runner.ts';
import {
    GetSpace,
    ListStructures,
    SearchObjects,
    ListObjectsByStructure,
    GetObject,
    CreateLogObject,
    AppendEntityToDailyNote,
    DeleteObject,
} from './ops.ts';
import type { Transport } from './transport/types.ts';
import type {
    CaptureInput,
    CaptureResult,
    SetupOptions,
    SetupResult,
    ListInRangeInput,
    HydratedObject,
    CapacitiesObject,
    CapacitiesStructure,
    GetDailyNotesOptions,
} from './types.ts';

export const DEFAULT_LOG_TITLES = ['DailyLog', 'Daily Log', 'Log', 'Note'];

// readProperty unwraps Capacities { type, <type>: { value } } property envelope.
export function readProperty(
    obj: Partial<CapacitiesObject> | { properties?: Record<string, any> } | null | undefined,
    name: string,
): unknown {
    if (!obj || !obj.properties) return undefined;
    const propertyEntry = (obj.properties as Record<string, any>)[name];
    if (!propertyEntry) return undefined;
    const propertyType = typeof propertyEntry.type === 'string' ? propertyEntry.type : '';
    const payload = (propertyEntry[name] || (propertyType ? propertyEntry[propertyType] : undefined) || propertyEntry);
    if (payload && typeof payload === 'object' && 'value' in payload) {
        return (payload as { value: unknown }).value;
    }
    return payload;
}

// capture — the cap <note> flow.
export function capture(transport: Transport, { text, structureId }: CaptureInput): CaptureResult {
    const object = run(CreateLogObject, { text, structureId }, transport);
    try {
        run(AppendEntityToDailyNote, { objectId: object.id }, transport);
        return { object, embedded: true };
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { object, embedded: false, warning: msg };
    }
}

// setup — cap:setup. Idempotent bootstrap: verifies token, discovers log structure.
export function setup(transport: Transport, opts?: SetupOptions): SetupResult {
    const candidateTitles = opts?.candidateTitles || DEFAULT_LOG_TITLES;
    const forceStructureId = opts?.forceStructureId;

    const space = run(GetSpace, {}, transport);
    const structuresResp = run(ListStructures, {}, transport);
    const list: CapacitiesStructure[] = structuresResp?.structures || [];

    if (forceStructureId) {
        const match = list.find(s => String(s.id) === String(forceStructureId));
        if (match) {
            return { space, structureId: match.id, structureTitle: match.title || '' };
        }
        if (/^Root/.test(String(forceStructureId))) {
            return { space, structureId: forceStructureId, structureTitle: forceStructureId };
        }
        throw new Error(`setup: forced structureId ${forceStructureId} is not in this space`);
    }

    const pick = findLogStructure(list, candidateTitles);
    if (!pick) {
        const known = list.map(s => `  · ${s.title || '(untitled)'}  [${s.id}]`).join('\n');
        throw new Error(
            `setup: no content type matching ${JSON.stringify(candidateTitles)} in this space.\n` +
            `Create a content type in the Capacities app (Settings → Content types → New — call it "DailyLog"), then re-run cap:setup.\n` +
            `Structures currently in this space:\n${known || '  (none listed)'}`
        );
    }
    return { space, structureId: pick.id, structureTitle: pick.title || '' };
}

// findLogStructure: case-insensitive title match against candidate titles, skipping Root*
export function findLogStructure(
    list: CapacitiesStructure[],
    candidateTitles: string[],
): CapacitiesStructure | null {
    if (!Array.isArray(list) || list.length === 0) return null;
    const userDefined = list.filter(s => !/^Root/.test(String(s.id || '')));
    for (const wanted of candidateTitles) {
        const wantedLc = String(wanted).toLowerCase();
        const hit = userDefined.find(s => String(s.title || '').toLowerCase() === wantedLc);
        if (hit) return hit;
    }
    return null;
}

// listInRange: enumerate by structure id and hydrate each to filter on real createdAt
export function listInRange(
    transport: Transport,
    { structureId, from, to }: ListInRangeInput,
): HydratedObject[] {
    const resp = run(ListObjectsByStructure, { structureId }, transport);
    const stubs = resp?.results || [];
    const hydrated: HydratedObject[] = stubs.map((stub) => {
        const full = run(GetObject, { id: stub.id }, transport);
        return {
            id: full.id,
            structureId: full.structureId,
            title: readProperty(full, 'title') as string | undefined,
            createdAt: readProperty(full, 'createdAt') as string | undefined,
            lastUpdated: readProperty(full, 'lastUpdated') as string | undefined,
            deepLink: (full as any).deepLink,
            url: (full as any).url,
            raw: full,
        };
    });
    return filterByDate(hydrated, { from, to });
}

// getDailyNotes: searches RootDailyNote across ±marginDays around anchor
export function getDailyNotes(
    transport: Transport,
    opts?: GetDailyNotesOptions,
): CapacitiesObject[] {
    const anchor = opts?.date instanceof Date ? opts.date : new Date();
    const margin = Number.isFinite(opts?.marginDays) ? (opts?.marginDays as number) : 1;

    const days: string[] = [];
    for (let d = -margin; d <= margin; d++) {
        const day = new Date(anchor.getTime());
        day.setUTCDate(day.getUTCDate() + d);
        days.push(day.toISOString().slice(0, 10));
    }

    const found: CapacitiesObject[] = [];
    const seen = new Set<string>();
    for (const isoDay of days) {
        const search = run(SearchObjects, {
            query: isoDay,
            structureIds: ['RootDailyNote'],
        }, transport);
        const results = search?.results || (search as any)?.objects || [];
        for (const stub of results) {
            if (!(stub.title || '').startsWith(isoDay)) continue;
            if (seen.has(stub.id)) continue;
            seen.add(stub.id);
            found.push(run(GetObject, { id: stub.id }, transport));
        }
    }
    return found;
}

export function getDailyNote(
    transport: Transport,
    opts?: GetDailyNotesOptions,
): CapacitiesObject | null {
    const notes = getDailyNotes(transport, opts);
    return notes[0] || null;
}

export function deleteObject(transport: Transport, { id }: { id: string }): null {
    return run(DeleteObject, { id }, transport);
}
