// test/flows.test.ts — flows against mockTransport.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    capture,
    setup,
    findLogStructure,
    listInRange,
    readProperty,
    getDailyNotes,
    getDailyNote,
    deleteObject,
    createWeblink,
    findWeblinkByUrl,
    extractParagraphs,
    formatMarkdownLink,
} from '../src/flows.ts';
import { ApiError } from '../src/runner.ts';
import { makeMockTransport } from '../src/transport/mock.ts';

function captureFixtures(overrides: Record<string, any> = {}) {
    return {
        'POST /object/markdown': { status: 200, text: '{"id":"obj-1","title":"hi"}' },
        'POST /blocks/daily-note/append': { status: 204, text: '' },
        ...overrides,
    };
}

test('capture: fires both ops in order and threads the id from op 1 → op 2', () => {
    const t = makeMockTransport(captureFixtures());
    const result = capture(t, { text: 'hello', structureId: 'log-struct' });
    assert.equal(result.embedded, true);
    assert.equal(result.object.id, 'obj-1');

    assert.equal(t.calls.length, 2);
    assert.equal(t.calls[0].path, '/object/markdown');
    assert.equal(t.calls[1].path, '/blocks/daily-note/append');
    assert.equal(
        (t.calls[1].body as any).blocks[0].entityId,
        'obj-1',
        'the embed must reference the id returned by the first op',
    );
});

test('capture: a failing embed step warns but returns the object', () => {
    const t = makeMockTransport(captureFixtures({
        'POST /blocks/daily-note/append': { status: 500, text: '{"error":"boom"}' },
    }));
    const result = capture(t, { text: 'hello', structureId: 'log-struct' });
    assert.equal(result.embedded, false);
    assert.equal(result.object.id, 'obj-1');
    assert.match(result.warning || '', /500/);
});

test('capture: object-creation failure bubbles up as ApiError', () => {
    const t = makeMockTransport({
        'POST /object/markdown': { status: 401, text: '{"code":"unauthorized"}' },
    });
    assert.throws(
        () => capture(t, { text: 'hi', structureId: 'log-struct' }),
        (e: unknown) => e instanceof ApiError && e.status === 401,
    );
});

test('setup: picks the user-defined DailyLog content type', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1","title":"Home"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({
                structures: [
                    { id: 'RootTag', title: 'Tag' },
                    { id: 'RootDailyNote', title: 'Daily Note' },
                    { id: 'usr-dl-uuid', title: 'DailyLog' },
                ],
            }),
        },
    });
    const result = setup(t);
    assert.equal(result.space.id, 'sp1');
    assert.equal(result.structureId, 'usr-dl-uuid');
    assert.equal(result.structureTitle, 'DailyLog');
});

test('setup: falls back through candidate titles in order', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({
                structures: [
                    { id: 'RootTag', title: 'Tag' },
                    { id: 'usr-log', title: 'Log' },
                    { id: 'usr-daily-log', title: 'Daily Log' },
                ],
            }),
        },
    });
    const result = setup(t);
    assert.equal(result.structureId, 'usr-daily-log');
});

test('setup: throws helpfully when no matching content type exists', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({
                structures: [
                    { id: 'RootTag', title: 'Tag' },
                    { id: 'RootTask', title: 'Task' },
                    { id: 'RootDailyNote', title: 'Daily Note' },
                ],
            }),
        },
    });
    assert.throws(
        () => setup(t),
        (e: unknown) => /Create a content type in the Capacities app/.test((e as Error).message),
    );
});

test('setup: forceStructureId bypasses discovery when the id is listed', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({
                structures: [{ id: 'RootTask', title: 'Task' }],
            }),
        },
    });
    const result = setup(t, { forceStructureId: 'RootTask' });
    assert.equal(result.structureId, 'RootTask');
    assert.equal(result.structureTitle, 'Task');
});

test('setup: forceStructureId errors if a user id is not in the space', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({ structures: [{ id: 'RootTag', title: 'Tag' }] }),
        },
    });
    assert.throws(
        () => setup(t, { forceStructureId: 'unknown-uuid' }),
        /not in this space/,
    );
});

test('setup: forceStructureId=RootPage works even when not listed', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({ structures: [{ id: 'RootTag', title: 'Tag' }] }),
        },
    });
    const result = setup(t, { forceStructureId: 'RootPage' });
    assert.equal(result.structureId, 'RootPage');
});

test('findLogStructure: skips built-in Root* structures', () => {
    const list = [
        { id: 'RootDailyNote', title: 'DailyLog' },
        { id: 'usr-1', title: 'Book' },
    ];
    assert.equal(findLogStructure(list, ['DailyLog']), null);
});

test('readProperty: unwraps property envelope variants or returns undefined', () => {
    assert.equal(readProperty(null, 'title'), undefined);
    assert.equal(readProperty({ id: '1' }, 'title'), undefined);
    assert.equal(readProperty({ id: '1', properties: {} }, 'title'), undefined);
    assert.equal(
        readProperty({
            id: '1',
            properties: {
                title: { type: 'title', title: { value: 'Test Title' } },
            },
        }, 'title'),
        'Test Title',
    );
    assert.equal(
        readProperty({
            id: '1',
            properties: {
                custom: { type: 'customType', customType: { value: 123 } },
            },
        }, 'custom'),
        123,
    );
    assert.equal(
        readProperty({
            id: '1',
            properties: {
                direct: 'plain-string',
            },
        }, 'direct'),
        'plain-string',
    );
});

test('listInRange: hydrates each stub via GET /object and filters by createdAt', () => {
    const stubs = [
        { id: 'old', title: 'Old note', structureId: 'usr-dl' },
        { id: 'mid', title: 'Mid note', structureId: 'usr-dl' },
        { id: 'new', title: 'New note', structureId: 'usr-dl' },
        { id: 'malformed', title: 'Bad date', structureId: 'usr-dl' },
    ];
    const propsFor = (id: string, iso: string) => ({
        id,
        structureId: 'usr-dl',
        properties: {
            title: { type: 'title', title: { value: `${id} note` } },
            createdAt: { type: 'createdAt', createdAt: { value: iso } },
        },
    });
    const byId: Record<string, any> = {
        old: propsFor('old', '2026-09-01T00:00:00Z'),
        mid: propsFor('mid', '2026-09-10T00:00:00Z'),
        new: propsFor('new', '2026-09-13T11:59:00Z'),
        malformed: propsFor('malformed', 'not a date'),
    };

    const t = makeMockTransport({
        'GET /objects/structure': { status: 200, text: JSON.stringify({ results: stubs }) },
        'GET /object': (req) => ({
            status: 200,
            text: JSON.stringify(byId[(req.query as any).id]),
        }),
    });
    const results = listInRange(t, {
        structureId: 'usr-dl',
        from: new Date('2026-09-08T00:00:00Z'),
        to: new Date('2026-09-13T12:00:00Z'),
    });
    assert.deepEqual(results.map(o => o.id), ['new', 'mid']);
    assert.equal(results[0].createdAt, '2026-09-13T11:59:00Z');
    assert.equal(results[0].title, 'new note');
});

test('getDailyNotes and getDailyNote: search and retrieve daily notes', () => {
    const noteId = 'daily-note-1';
    const t = makeMockTransport({
        'POST /objects/search': {
            status: 200,
            text: JSON.stringify({
                results: [{ id: noteId, title: '2026-09-13T00:00:00.000Z' }],
            }),
        },
        'GET /object': {
            status: 200,
            text: JSON.stringify({ id: noteId, title: '2026-09-13T00:00:00.000Z' }),
        },
    });
    const notes = getDailyNotes(t, { date: new Date('2026-09-13T12:00:00Z'), marginDays: 0 });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, noteId);

    const single = getDailyNote(t, { date: new Date('2026-09-13T12:00:00Z'), marginDays: 0 });
    assert.equal(single?.id, noteId);
});

test('deleteObject: calls DeleteObject', () => {
    const t = makeMockTransport({
        'DELETE /object': { status: 204, text: '' },
    });
    const res = deleteObject(t, { id: 'obj-to-del' });
    assert.equal(res, null);
    assert.equal(t.calls.length, 1);
    assert.equal((t.calls[0].query as any).id, 'obj-to-del');
});

test('extractParagraphs: handles default and custom counts', () => {
    const text = 'Para 1\n\nPara 2\n\nPara 3\n\nPara 4\n\nPara 5';
    assert.equal(extractParagraphs(text), 'Para 1\n\nPara 2\n\nPara 3');
    assert.equal(extractParagraphs(text, 2), 'Para 1\n\nPara 2');
    assert.equal(extractParagraphs(text, 10), text);
});

test('extractParagraphs: handles empty input, whitespace, and single paragraphs', () => {
    assert.equal(extractParagraphs(''), '');
    assert.equal(extractParagraphs('   \n\n   '), '');
    assert.equal(extractParagraphs('Single para'), 'Single para');
    assert.equal(extractParagraphs('P1\n\n\n\n\nP2\n\n  \n\nP3'), 'P1\n\nP2\n\nP3');
});

test('formatMarkdownLink: creates [title](url) links', () => {
    assert.equal(formatMarkdownLink('My Page', 'https://example.com'), '[My Page](https://example.com)');
    assert.equal(formatMarkdownLink('', 'https://example.com'), '[https://example.com](https://example.com)');
});

test('createWeblink: builds typed CreateObjectFromUrlBody and calls transport', () => {
    const t = makeMockTransport({
        'POST /objects/search': { status: 200, text: '{"results":[]}' },
        'GET /objects/structure': { status: 200, text: '{"results":[]}' },
        'POST /object/url': {
            status: 200,
            text: JSON.stringify({ id: 'wl-100', structureId: 'MediaWebResource' }),
        },
    });

    const res = createWeblink(t, {
        url: 'https://example.com/article',
        title: 'Article Title',
        text: 'First paragraph summary.\n\nSecond paragraph body.',
    });

    assert.equal(res.id, 'wl-100');
    const createCall = t.calls.find(c => c.path === '/object/url');
    assert.ok(createCall);
    assert.equal(createCall.method, 'POST');

    const body = createCall.body as any;
    assert.equal(body.url, 'https://example.com/article');
    assert.deepEqual(body.properties.title, { type: 'title', title: { value: 'Article Title' } });
    assert.deepEqual(body.properties.description, { type: 'text', text: { value: 'First paragraph summary.' } });
    assert.equal(body.markdown, 'First paragraph summary.\n\nSecond paragraph body.');
});

test('createWeblink: throws on missing url', () => {
    const t = makeMockTransport({});
    assert.throws(() => createWeblink(t, { url: '', title: 'Test' }));
});

test('findWeblinkByUrl: finds existing weblink matching media_URLReference', () => {
    const t = makeMockTransport({
        'POST /objects/search': {
            status: 200,
            text: JSON.stringify({ results: [{ id: 'wl-existing', title: 'Example Title' }] }),
        },
        'GET /object': {
            status: 200,
            text: JSON.stringify({
                id: 'wl-existing',
                title: 'Example Title',
                properties: {
                    media_URLReference: { type: 'url', url: { value: 'https://example.com/target' } },
                },
            }),
        },
    });

    const hit = findWeblinkByUrl(t, { url: 'https://example.com/target', title: 'Example Title' });
    assert.ok(hit);
    assert.equal(hit?.id, 'wl-existing');
});

test('createWeblink: deletes existing weblink if URL already exists before creating new one', () => {
    const t = makeMockTransport({
        'POST /objects/search': {
            status: 200,
            text: JSON.stringify({ results: [{ id: 'wl-old', title: 'Old Title' }] }),
        },
        'GET /object': {
            status: 200,
            text: JSON.stringify({
                id: 'wl-old',
                title: 'Old Title',
                properties: {
                    media_URLReference: { type: 'url', url: { value: 'https://example.com/target' } },
                },
            }),
        },
        'DELETE /object': {
            status: 204,
            text: '',
        },
        'POST /object/url': {
            status: 200,
            text: JSON.stringify({ id: 'wl-new', structureId: 'MediaWebResource' }),
        },
    });

    const res = createWeblink(t, {
        url: 'https://example.com/target',
        title: 'Old Title',
        text: 'Updated notes',
    });

    assert.equal(res.id, 'wl-new');
    const deleteCall = t.calls.find(c => c.path === '/object' && c.method === 'DELETE');
    assert.ok(deleteCall, 'Must call DELETE /object for existing id');
    assert.equal((deleteCall?.query as any).id, 'wl-old');
});
