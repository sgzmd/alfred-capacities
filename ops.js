// ops.js — pure. One plain object per Capacities v1 API call.
//
// Each op is a two-method contract:
//   build(input) → { method, path, body?, query? }
//   parse(rawText) → any
//
// No headers, no baseUrl, no token — that's the transport's job. Nothing here
// touches HTTP or JXA globals. Adding a new endpoint = adding one object.

(function (root) {
    'use strict';

    const jsonParse = (t) => (t && t.length ? JSON.parse(t) : null);
    const nullParse = () => null;

    // Space-scoped v1 tokens: no spaceId in any body.

    const GetSpace = {
        name: 'GetSpace',
        build: () => ({ method: 'GET', path: '/space' }),
        parse: jsonParse, // → { id, title, ... }
    };

    const ListStructures = {
        name: 'ListStructures',
        build: () => ({ method: 'GET', path: '/space/structures' }),
        parse: jsonParse, // → { structures: [ ... ] }
    };

    // Enumerate every object of a given structure. Same abridged shape as
    // /objects/tag: rows carry only {id, title, structureId}, so range
    // filtering needs a per-id hydration pass via GetObject.
    const ListObjectsByStructure = {
        name: 'ListObjectsByStructure',
        build: ({ structureId }) => ({
            method: 'GET',
            path: '/objects/structure',
            query: { id: structureId },
        }),
        parse: jsonParse, // → { results: [{id, title, structureId}], nextCursor, hasMore }
    };

    // Fetch a single object with full properties (createdAt, tags, …).
    // Used by listInRange to enrich abridged tag/search results.
    const GetObject = {
        name: 'GetObject',
        build: ({ id }) => {
            if (!id) throw new Error('GetObject: id is required');
            return { method: 'GET', path: '/object', query: { id } };
        },
        parse: jsonParse,
    };

    // Search by structure — used at setup to find an existing DailyLog RootTag
    // without hard-coding an id.
    const SearchObjects = {
        name: 'SearchObjects',
        build: ({ query, structureIds }) => ({
            method: 'POST',
            path: '/objects/search',
            body: {
                query: query || '',
                ...(structureIds ? { structureIds } : {}),
            },
        }),
        parse: jsonParse, // → { objects: [...] }
    };

    // Threshold at which we decide the raw first line is "too long" for a
    // title. Longer than this and we strip markdown syntax to get a clean
    // reading version. A hard mid-string cut at 60 produced titles like
    // "Updating [ESA_Data_Export_Q3.xlsx](https://coupangnam-my.sha…" —
    // unreadable.
    const TITLE_MAX = 60;
    // Sanity cap on the stripped title, so a pathological 500-char first
    // line doesn't produce a 500-char title. Well above typical prose so it
    // almost never trips.
    const TITLE_MAX_PLAIN = 200;

    // splitTitleAndBody(text) → { title, body }
    //
    // Two-branch rule:
    //   - The raw first line fits (≤ TITLE_MAX, single line): use it
    //     verbatim as the title. No body. Preserves markdown in the title
    //     for the case where it doesn't cause visible truncation.
    //   - Otherwise: strip markdown from the first line to a clean plain
    //     text and use that as the title; body keeps the original input,
    //     markdown intact. Applies a generous 200-char cap with a
    //     word-boundary trim as final defence.
    //
    // The body always carries the full original input when a body exists,
    // so links and formatting are never lost — they just move out of the
    // title.
    function splitTitleAndBody(text) {
        const trimmed = String(text).trim();
        const firstLine = trimmed.split(/\r?\n/)[0];

        // Fits verbatim in the title alone → no truncation, no body.
        if (trimmed === firstLine && trimmed.length <= TITLE_MAX) {
            return { title: trimmed, body: null };
        }
        // Truncation would happen. Strip markdown so the reader sees text,
        // not link syntax.
        const plain = stripMarkdownInline(firstLine);
        const title = plain.length <= TITLE_MAX_PLAIN
            ? plain
            : truncateAtWordBoundary(plain, TITLE_MAX_PLAIN);
        return { title: title, body: trimmed };
    }

    function truncateAtWordBoundary(s, max) {
        s = String(s);
        if (s.length <= max) return s;
        const window = s.slice(0, max);
        const lastSpace = window.lastIndexOf(' ');
        const cut = lastSpace >= Math.floor(max / 2) ? lastSpace : max;
        return s.slice(0, cut).replace(/[\s.,;:—-]+$/, '') + '…';
    }

    // stripMarkdownInline(s) — collapse common inline markdown to plain text.
    // Handles the constructs likely to appear in the first line of a quick
    // capture: links, images, bold, italic, inline code, strikethrough.
    // Deliberately conservative around underscore-italic so filenames like
    // ESA_Data_Export_Q3.xlsx survive untouched.
    function stripMarkdownInline(s) {
        let t = String(s);
        // Images ![alt](url) → alt   (must run before plain links)
        t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
        // Links [label](url) → label
        t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
        // Reference-style [label][ref] → label
        t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
        // Inline code `text` → text
        t = t.replace(/`([^`]+)`/g, '$1');
        // Bold **text** and __text__ → text
        t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
        t = t.replace(/__([^_]+)__/g, '$1');
        // Italic *text* → text (require the star not to be doubled).
        t = t.replace(/(?<!\*)\*([^\s*][^*]*?)\*(?!\*)/g, '$1');
        // Italic _text_ → text ONLY when the underscore is at a word edge —
        // "foo_bar_baz" and "ESA_Data_Export" must NOT be split.
        t = t.replace(/(?<![A-Za-z0-9])_([^\s_][^_]*?)_(?![A-Za-z0-9])/g, '$1');
        // Strikethrough ~~text~~ → text
        t = t.replace(/~~([^~]+)~~/g, '$1');
        // Collapse runs of whitespace introduced by removals.
        t = t.replace(/[ \t]{2,}/g, ' ').trim();
        return t;
    }

    // The capture write.
    //
    // Two endpoints, both with silent drops:
    //   - POST /object          honours properties.title, discards markdown
    //     (body ends up as an empty TextBlock — verified live).
    //   - POST /object/markdown honours markdown (rendering links etc.),
    //     discards properties; instead pulls the title from the first H1.
    //
    // We use /object/markdown and prepend `# <title>\n\n` when there's a body,
    // or just `# <title>` when the input is short enough to fit in the title
    // alone. The first-H1 rule strips that line out of the rendered body, so
    // there's no visible duplication — verified live: the LinkToken and every
    // other inline token survives.
    //
    // No `tags` property — retrievability comes from the object's own
    // structureId, which we list via GET /objects/structure.
    const CreateLogObject = {
        name: 'CreateLogObject',
        build: ({ text, structureId }) => {
            if (!text || !text.trim()) throw new Error('CreateLogObject: text is required');
            if (!structureId) throw new Error('CreateLogObject: structureId is required');
            const { title, body } = splitTitleAndBody(text);
            const heading = escapeForH1(title);
            const markdown = body != null ? `# ${heading}\n\n${body}` : `# ${heading}`;
            return {
                method: 'POST',
                path: '/object/markdown',
                body: {
                    structureId: structureId,
                    markdown: markdown,
                },
            };
        },
        parse: jsonParse, // → { id, structureId, properties, blocks, ... }
        // Exposed so tests and dev tooling can share the same splitter.
        _splitTitleAndBody: splitTitleAndBody,
        _escapeForH1: escapeForH1,
        _stripMarkdownInline: stripMarkdownInline,
    };

    // A one-line title on an H1 line. Strip newlines defensively; leave the
    // rest alone — the API stores the literal string as the title, verbatim.
    // (Verified live: "# Jotted down [PIPS…" round-trips to title
    // "Jotted down [PIPS…" without eating the bracket.)
    function escapeForH1(s) {
        return String(s).replace(/[\r\n]+/g, ' ').trim();
    }

    // Insert an EntityBlock into today's daily note referencing the new object.
    // The block wants `entityId` as a top-level string, NOT `entity: { id }` —
    // the API returns 400 with "expected string at blocks[0].entityId" otherwise.
    const AppendEntityToDailyNote = {
        name: 'AppendEntityToDailyNote',
        build: ({ objectId, date }) => {
            if (!objectId) throw new Error('AppendEntityToDailyNote: objectId is required');
            const body = {
                blocks: [{ type: 'EntityBlock', entityId: objectId }],
            };
            if (date) body.date = date; // ISO 8601 UTC; omit → today
            return { method: 'POST', path: '/blocks/daily-note/append', body };
        },
        parse: nullParse, // 204 No Content
    };

// Delete uses a query-string id, not a path segment. `DELETE /object/{id}`
    // 404s; `DELETE /object?id={id}` is the working shape.
    const DeleteObject = {
        name: 'DeleteObject',
        build: ({ id }) => {
            if (!id) throw new Error('DeleteObject: id is required');
            return { method: 'DELETE', path: '/object', query: { id } };
        },
        parse: nullParse,
    };

    const ops = {
        GetSpace,
        ListStructures,
        ListObjectsByStructure,
        GetObject,
        SearchObjects,
        CreateLogObject,
        AppendEntityToDailyNote,
        DeleteObject,
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ops;
    } else {
        root.ops = ops;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
