// test/flows.test.js — the four flows against mockTransport.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const flows = require('../flows.js');
const { ApiError } = require('../runner.js');
const { makeMockTransport } = require('../transport/mock.js');

function captureFixtures(overrides = {}) {
    return {
        // /object/markdown, not /object — see AGENTS.md: POST /object silently
        // drops markdown, so captures use /object/markdown with an H1 title.
        'POST /object/markdown': { status: 200, text: '{"id":"obj-1","title":"hi"}' },
        'POST /blocks/daily-note/append': { status: 204, text: '' },
        ...overrides,
    };
}

test('capture: fires both ops in order and threads the id from op 1 → op 2', () => {
    const t = makeMockTransport(captureFixtures());
    const result = flows.capture(t, { text: 'hello', structureId: 'log-struct' });
    assert.equal(result.embedded, true);
    assert.equal(result.object.id, 'obj-1');

    assert.equal(t.calls.length, 2);
    assert.equal(t.calls[0].path, '/object/markdown');
    assert.equal(t.calls[1].path, '/blocks/daily-note/append');
    assert.equal(t.calls[1].body.blocks[0].entityId, 'obj-1',
        'the embed must reference the id returned by the first op');
});

test('capture: a failing embed step warns but returns the object', () => {
    const t = makeMockTransport(captureFixtures({
        'POST /blocks/daily-note/append': { status: 500, text: '{"error":"boom"}' },
    }));
    const result = flows.capture(t, { text: 'hello', structureId: 'log-struct' });
    assert.equal(result.embedded, false);
    assert.equal(result.object.id, 'obj-1');
    assert.match(result.warning, /500/);
});

test('capture: object-creation failure bubbles up as ApiError', () => {
    const t = makeMockTransport({
        'POST /object/markdown': { status: 401, text: '{"code":"unauthorized"}' },
    });
    assert.throws(
        () => flows.capture(t, { text: 'hi', structureId: 'log-struct' }),
        (e) => e instanceof ApiError && e.status === 401,
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
    const result = flows.setup(t);
    assert.equal(result.space.id, 'sp1');
    assert.equal(result.structureId, 'usr-dl-uuid');
    assert.equal(result.structureTitle, 'DailyLog');
});

test('setup: falls back through candidate titles in order', () => {
    // No exact "DailyLog", but "Daily Log" and "Log" both exist. Order in
    // DEFAULT_LOG_TITLES makes "Daily Log" win over "Log".
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
    const result = flows.setup(t);
    assert.equal(result.structureId, 'usr-daily-log');
});

test('setup: throws helpfully when no matching content type exists', () => {
    // Bare space — only Root* structures, no user-defined type. This is
    // exactly the state a fresh workspace is in until the user creates one.
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
        () => flows.setup(t),
        (e) => /Create a content type in the Capacities app/.test(e.message),
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
    const result = flows.setup(t, { forceStructureId: 'RootTask' });
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
        () => flows.setup(t, { forceStructureId: 'unknown-uuid' }),
        /not in this space/,
    );
});

test('setup: forceStructureId=RootPage works even when not listed', () => {
    // Bare space that doesn't advertise RootPage — the built-in still works.
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"sp1"}' },
        'GET /space/structures': {
            status: 200,
            text: JSON.stringify({ structures: [{ id: 'RootTag', title: 'Tag' }] }),
        },
    });
    const result = flows.setup(t, { forceStructureId: 'RootPage' });
    assert.equal(result.structureId, 'RootPage');
});

test('findLogStructure: skips built-in Root* structures', () => {
    // A hypothetical space where the built-in DailyNote is titled "DailyLog"
    // wouldn't confuse us — Root* are excluded before matching.
    const list = [
        { id: 'RootDailyNote', title: 'DailyLog' },
        { id: 'usr-1', title: 'Book' },
    ];
    assert.equal(flows.findLogStructure(list, ['DailyLog']), null);
});

test('listInRange: hydrates each stub via GET /object and filters by createdAt', () => {
    // GET /objects/structure returns abridged rows; the flow hydrates each
    // one via GET /object to get the real createdAt, then filters and sorts.
    const stubs = [
        { id: 'old', title: 'Old note', structureId: 'usr-dl' },
        { id: 'mid', title: 'Mid note', structureId: 'usr-dl' },
        { id: 'new', title: 'New note', structureId: 'usr-dl' },
        { id: 'malformed', title: 'Bad date', structureId: 'usr-dl' },
    ];
    const propsFor = (id, iso) => ({
        id: id,
        structureId: 'usr-dl',
        properties: {
            title: { type: 'title', title: { value: `${id} note` } },
            createdAt: { type: 'createdAt', createdAt: { value: iso } },
        },
    });
    const byId = {
        old: propsFor('old', '2026-09-01T00:00:00Z'),
        mid: propsFor('mid', '2026-09-10T00:00:00Z'),
        new: propsFor('new', '2026-09-13T11:59:00Z'),
        malformed: propsFor('malformed', 'not a date'),
    };

    const t = makeMockTransport({
        'GET /objects/structure': { status: 200, text: JSON.stringify({ results: stubs }) },
        'GET /object': (req) => ({
            status: 200,
            text: JSON.stringify(byId[req.query.id]),
        }),
    });
    const results = flows.listInRange(t, {
        structureId: 'usr-dl',
        from: new Date('2026-09-08T00:00:00Z'),
        to: new Date('2026-09-13T12:00:00Z'),
    });
    assert.deepEqual(results.map(o => o.id), ['new', 'mid']);
    assert.equal(results[0].createdAt, '2026-09-13T11:59:00Z');
    assert.equal(results[0].title, 'new note');
});
