// src/ops.ts — pure. One plain object per Capacities v1 API call.
//
// Each op is a two-method contract:
//   build(input) → { method, path, body?, query? }
//   parse(rawText) → any

import type {
    Op,
    CapacitiesSpace,
    ListStructuresResponse,
    ListObjectsByStructureResponse,
    CapacitiesObject,
    SearchObjectsResponse,
    GetObjectParams,
    DeleteObjectParams,
    SearchObjectsBody,
} from './types.ts';

const jsonParse = <T>(t: string): T => (t && t.length ? JSON.parse(t) : (null as unknown as T));
const nullParse = (): null => null;

export const GetSpace: Op<Record<string, never>, CapacitiesSpace> = {
    name: 'GetSpace',
    build: () => ({ method: 'GET', path: '/space' }),
    parse: jsonParse<CapacitiesSpace>,
};

export const ListStructures: Op<Record<string, never>, ListStructuresResponse> = {
    name: 'ListStructures',
    build: () => ({ method: 'GET', path: '/space/structures' }),
    parse: jsonParse<ListStructuresResponse>,
};

export const ListObjectsByStructure: Op<{ structureId: string } | { id: string }, ListObjectsByStructureResponse> = {
    name: 'ListObjectsByStructure',
    build: (input) => {
        const id = 'structureId' in input ? input.structureId : input.id;
        if (!id) throw new Error('ListObjectsByStructure: structureId is required');
        return {
            method: 'GET',
            path: '/objects/structure',
            query: { id },
        };
    },
    parse: jsonParse<ListObjectsByStructureResponse>,
};

export const GetObject: Op<GetObjectParams, CapacitiesObject> = {
    name: 'GetObject',
    build: ({ id }) => {
        if (!id) throw new Error('GetObject: id is required');
        return { method: 'GET', path: '/object', query: { id } };
    },
    parse: jsonParse<CapacitiesObject>,
};

export const SearchObjects: Op<SearchObjectsBody, SearchObjectsResponse> = {
    name: 'SearchObjects',
    build: ({ query, structureIds }) => ({
        method: 'POST',
        path: '/objects/search',
        body: {
            query: query || '',
            ...(structureIds ? { structureIds } : {}),
        },
    }),
    parse: jsonParse<SearchObjectsResponse>,
};

export const TITLE_MAX = 60;
export const TITLE_MAX_PLAIN = 200;

export interface SplitResult {
    title: string;
    body: string | null;
}

export function splitTitleAndBody(text: string): SplitResult {
    const trimmed = String(text || '').trim();
    const firstLine = trimmed.split(/\r?\n/)[0];

    // Fits verbatim in the title alone → no truncation, no body.
    if (trimmed === firstLine && trimmed.length <= TITLE_MAX) {
        return { title: trimmed, body: null };
    }
    // Truncation would happen. Strip markdown so the reader sees text, not link syntax.
    const plain = stripMarkdownInline(firstLine);
    const title = plain.length <= TITLE_MAX_PLAIN
        ? plain
        : truncateAtWordBoundary(plain, TITLE_MAX_PLAIN);
    return { title: title, body: trimmed };
}

export function truncateAtWordBoundary(s: string, max: number): string {
    const str = String(s);
    if (str.length <= max) return str;
    const window = str.slice(0, max);
    const lastSpace = window.lastIndexOf(' ');
    const cut = lastSpace >= Math.floor(max / 2) ? lastSpace : max;
    return str.slice(0, cut).replace(/[\s.,;:—-]+$/, '') + '…';
}

export function stripMarkdownInline(s: string): string {
    let t = String(s);
    // Images ![alt](url) → alt (must run before plain links)
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

export function escapeForH1(s: string): string {
    return String(s).replace(/[\r\n]+/g, ' ').trim();
}

export const CreateLogObject: Op<{ text: string; structureId: string }, CapacitiesObject> = {
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
    parse: jsonParse<CapacitiesObject>,
};

export const AppendEntityToDailyNote: Op<{ objectId: string; date?: string }, null> = {
    name: 'AppendEntityToDailyNote',
    build: ({ objectId, date }) => {
        if (!objectId) throw new Error('AppendEntityToDailyNote: objectId is required');
        const body: { blocks: Array<{ type: string; entityId: string }>; date?: string } = {
            blocks: [{ type: 'EntityBlock', entityId: objectId }],
        };
        if (date) body.date = date; // ISO 8601 UTC; omit → today
        return { method: 'POST', path: '/blocks/daily-note/append', body };
    },
    parse: nullParse,
};

export const DeleteObject: Op<DeleteObjectParams, null> = {
    name: 'DeleteObject',
    build: ({ id }) => {
        if (!id) throw new Error('DeleteObject: id is required');
        return { method: 'DELETE', path: '/object', query: { id } };
    },
    parse: nullParse,
};

export const ops = {
    GetSpace,
    ListStructures,
    ListObjectsByStructure,
    GetObject,
    SearchObjects,
    CreateLogObject,
    AppendEntityToDailyNote,
    DeleteObject,
};
