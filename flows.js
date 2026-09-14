// flows.js — pure, synchronous. Named compositions of ops.
//
// Each flow takes (transport, input) and returns a plain value. Flows never
// touch HTTP directly — they call run(op, input, transport). Errors bubble as
// ApiError unless the flow explicitly demotes one (see capture()).

(function (root) {
    'use strict';

    const _runner = (typeof require !== 'undefined')
        ? require('./runner.js')
        : root.runner;
    const _ops = (typeof require !== 'undefined')
        ? require('./ops.js')
        : root.ops;

    const { run, filterByDate } = _runner;
    const {
        GetSpace,
        ListStructures,
        SearchObjects,
        ListObjectsByStructure,
        GetObject,
        CreateLogObject,
        AppendEntityToDailyNote,
        DeleteObject,
    } = _ops;

    // Default candidate titles for a user-defined "Log" structure. The user
    // creates one in the Capacities app (Settings → Content types → New);
    // cap:setup then finds it by title, case-insensitive. Order matters —
    // the first title that matches wins.
    const DEFAULT_LOG_TITLES = ['DailyLog', 'Daily Log', 'Log', 'Note'];

    // Capacities wraps every property in { type, <type>: { value } }. Unwrap
    // one for the caller. Returns undefined if the property is missing.
    function readProperty(obj, name) {
        const p = obj && obj.properties && obj.properties[name];
        if (!p) return undefined;
        const nested = p[name] || p[p.type] || p;
        if (nested && typeof nested === 'object' && 'value' in nested) return nested.value;
        return nested;
    }

    // capture — the cap <note> flow.
    //
    // Two ops: create the object as a user-defined Log-structure entity, then
    // embed it in today's daily note. If the embed fails, the object still
    // exists and is still enumerable via GET /objects/structure, so the flow
    // surfaces a warning rather than rolling back.
    //
    // Returns { object, embedded: boolean, warning?: string }.
    function capture(transport, { text, structureId }) {
        const object = run(CreateLogObject, { text, structureId }, transport);
        try {
            run(AppendEntityToDailyNote, { objectId: object.id }, transport);
            return { object: object, embedded: true };
        } catch (e) {
            return { object: object, embedded: false, warning: e.message };
        }
    }

    // setup — cap:setup. Idempotent bootstrap: verifies the token and finds a
    // user-defined "Log" content type in the space. That structure is where
    // every capture lands, and it's the sole retrieval key too — no tag needed.
    //
    // The API cannot create structures (verified: POST /structure, /structures,
    // /space/structures all 404). If none of DEFAULT_LOG_TITLES matches an
    // existing structure, throws with instructions on creating one.
    //
    // Returns { space, structureId, structureTitle }.
    function setup(transport, opts) {
        opts = opts || {};
        const candidateTitles = opts.candidateTitles || DEFAULT_LOG_TITLES;
        // Optional pre-picked id — useful for e2e against a bare test space
        // or for anyone who wants to point captures at a specific structure.
        const forceStructureId = opts.forceStructureId;

        const space = run(GetSpace, {}, transport);
        const structuresResp = run(ListStructures, {}, transport);
        const list = (structuresResp && (structuresResp.structures || structuresResp)) || [];

        if (forceStructureId) {
            const match = list.find(s => String(s.id) === String(forceStructureId));
            if (match) {
                return { space: space, structureId: match.id, structureTitle: match.title || '' };
            }
            // Built-in Root* structures (RootPage etc.) work even when not
            // advertised in /space/structures. Trust the caller.
            if (/^Root/.test(String(forceStructureId))) {
                return { space: space, structureId: forceStructureId, structureTitle: forceStructureId };
            }
            throw new Error(
                `setup: forced structureId ${forceStructureId} is not in this space`
            );
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
        return { space: space, structureId: pick.id, structureTitle: pick.title || '' };
    }

    // findLogStructure — case-insensitive title match against a preference
    // list. Skips built-in Root* structures because they aren't user-defined
    // content types.
    function findLogStructure(list, candidateTitles) {
        if (!Array.isArray(list) || list.length === 0) return null;
        const userDefined = list.filter(s => !/^Root/.test(String(s.id || '')));
        for (const wanted of candidateTitles) {
            const wantedLc = String(wanted).toLowerCase();
            const hit = userDefined.find(s => String(s.title || '').toLowerCase() === wantedLc);
            if (hit) return hit;
        }
        return null;
    }

    // listInRange — cap:log. GET /objects/structure returns abridged entries
    // ({id, title, structureId}) with no createdAt, so we hydrate each id
    // via GET /object?id=… and filter on the real createdAt. For typical use
    // (tens-to-hundreds of captures) this is fast enough; the transport
    // paces to avoid Cloudflare 1015.
    function listInRange(transport, { structureId, from, to }) {
        const resp = run(ListObjectsByStructure, { structureId: structureId }, transport);
        const stubs = (resp && (resp.results || resp.objects || resp)) || [];
        const hydrated = stubs.map((stub) => {
            const full = run(GetObject, { id: stub.id }, transport);
            return {
                id: full.id,
                structureId: full.structureId,
                title: readProperty(full, 'title'),
                createdAt: readProperty(full, 'createdAt'),
                lastUpdated: readProperty(full, 'lastUpdated'),
                raw: full,
            };
        });
        return filterByDate(hydrated, { from: from, to: to });
    }

    // No dedicated GET /blocks/daily-note endpoint exists (404s). Find one or
    // more daily-note objects via search, hydrate each. The server anchors
    // "today" to the account's local timezone, not UTC, so a capture at 22:59
    // UTC on day N can land on day N+1's daily note; e2e verification needs
    // both. Callers pass a date (defaults to now UTC) plus an optional
    // ±day margin.
    //
    // Returns the array of hydrated daily-note objects (0..2*margin+1 items),
    // sorted newest first.
    function getDailyNotes(transport, { date, marginDays } = {}) {
        const anchor = date instanceof Date ? date : new Date();
        const margin = Number.isFinite(marginDays) ? marginDays : 1;

        const days = [];
        for (let d = -margin; d <= margin; d++) {
            const day = new Date(anchor);
            day.setUTCDate(day.getUTCDate() + d);
            days.push(day.toISOString().slice(0, 10));
        }
        // One search per day (queries need ≥1 char, no way to OR).
        const found = [];
        const seen = new Set();
        for (const isoDay of days) {
            const search = run(SearchObjects, {
                query: isoDay,
                structureIds: ['RootDailyNote'],
            }, transport);
            const results = (search && (search.results || search.objects)) || [];
            for (const stub of results) {
                if (!(stub.title || '').startsWith(isoDay)) continue;
                if (seen.has(stub.id)) continue;
                seen.add(stub.id);
                found.push(run(GetObject, { id: stub.id }, transport));
            }
        }
        return found;
    }

    // Back-compat single-note helper: returns the daily note whose title
    // matches today-UTC, or null. Prefer getDailyNotes for verification.
    function getDailyNote(transport, opts) {
        const notes = getDailyNotes(transport, opts);
        return notes[0] || null;
    }

    function deleteObject(transport, { id }) {
        return run(DeleteObject, { id }, transport);
    }

    const api = {
        capture,
        setup,
        listInRange,
        getDailyNote,
        getDailyNotes,
        deleteObject,
        findLogStructure,
        DEFAULT_LOG_TITLES,
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.flows = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
