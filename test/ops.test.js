// test/ops.test.js — every op's build/parse contract.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ops = require('../ops.js');

test('GetSpace: GET /space, no body', () => {
    const req = ops.GetSpace.build();
    assert.deepEqual(req, { method: 'GET', path: '/space' });
    assert.deepEqual(ops.GetSpace.parse('{"id":"sp1","title":"Home"}'), { id: 'sp1', title: 'Home' });
});

test('ListStructures: GET /space/structures', () => {
    const req = ops.ListStructures.build();
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/space/structures');
});

test('ListObjectsByStructure: uses ?id= query on /objects/structure', () => {
    const req = ops.ListObjectsByStructure.build({ structureId: 'struct-abc' });
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/objects/structure');
    assert.deepEqual(req.query, { id: 'struct-abc' });
    assert.equal(req.body, undefined);
});

test('GetObject: uses ?id= query', () => {
    const req = ops.GetObject.build({ id: 'obj-xyz' });
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/object');
    assert.deepEqual(req.query, { id: 'obj-xyz' });
});

test('SearchObjects: POST /objects/search with optional structureIds', () => {
    assert.deepEqual(
        ops.SearchObjects.build({ query: 'DailyLog' }).body,
        { query: 'DailyLog' },
    );
    assert.deepEqual(
        ops.SearchObjects.build({ query: 'DailyLog', structureIds: ['RootTag'] }).body,
        { query: 'DailyLog', structureIds: ['RootTag'] },
    );
});

test('CreateLogObject: uses POST /object/markdown with H1-prefixed title', () => {
    const req = ops.CreateLogObject.build({
        text: 'Short note',
        structureId: 'log-struct-uuid',
    });
    assert.equal(req.method, 'POST');
    // Must be /object/markdown — POST /object silently drops the markdown
    // body (verified live).
    assert.equal(req.path, '/object/markdown');
    assert.equal(req.body.spaceId, undefined, 'spaceId must not appear in v1 payload');
    assert.equal(req.body.mdText, undefined);
    assert.equal(req.body.structureId, 'log-struct-uuid');
    // For short inputs the whole thing is the title (no separate body).
    assert.equal(req.body.markdown, '# Short note');
    // No properties field — /object/markdown ignores it (title comes from H1,
    // tags aren't wanted).
    assert.equal(req.body.properties, undefined);
});

// Helper: parse the H1 title back out of a `# <title>\n\n<body>` markdown string.
function splitBack(md) {
    const m = md.match(/^# (.*?)(?:\n\n([\s\S]*))?$/);
    return { title: m[1], body: m[2] };
}

test('CreateLogObject: short single-line input → H1-only markdown, no body', () => {
    const req = ops.CreateLogObject.build({ text: 'Hello world', structureId: 's' });
    assert.equal(req.body.markdown, '# Hello world');
    // No body after the heading.
    assert.equal(splitBack(req.body.markdown).body, undefined);
});

test('CreateLogObject: long input with markdown link → title stripped to plain text; body keeps markdown', () => {
    // Exact case from the screenshot: a markdown link followed by prose.
    // A raw slice would produce "Updating [ESA_Data_Export_Q3.xlsx](https://…"
    // — the reader sees mangled link syntax. Stripping fixes that.
    const text = 'Updating [ESA_Data_Export_Q3.xlsx](https://coupangnam-my.sharepoint.com/foo/bar) with Requirements and Capabilities for ATO work going forward.';
    const req = ops.CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack(req.body.markdown);
    assert.equal(
        title,
        'Updating ESA_Data_Export_Q3.xlsx with Requirements and Capabilities for ATO work going forward.',
    );
    assert.equal(body, text, 'body preserves the raw markdown link verbatim');
});

test('CreateLogObject: long plain input → no stripping needed; whole line becomes the title', () => {
    // No markdown syntax → stripping is a no-op. Under 200 chars, so the
    // full first line reads through as the title. Matches the user rule
    // "if and only if truncation will happen, strip Markdown".
    const text = 'Updating the deploy plan for Q3 with a lot of context that makes this line longer than sixty characters.';
    const req = ops.CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack(req.body.markdown);
    assert.equal(title, text);
    assert.equal(body, text);
});

test('CreateLogObject: multiline input → title = first line, body = full text', () => {
    const text = 'First line summary\n\nSecond paragraph with detail.';
    const req = ops.CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack(req.body.markdown);
    assert.equal(title, 'First line summary');
    assert.equal(body, text);
});

test('CreateLogObject: absurdly long input → 200-char word-boundary trim', () => {
    // Way past the 200-char safety cap.
    const text = ('word '.repeat(120)).trim(); // ~600 chars, word-boundary rich
    const req = ops.CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack(req.body.markdown);
    assert.ok(title.length <= 201, `title too long: ${title.length}`);
    assert.ok(title.endsWith('…'));
    assert.equal(body, text);
});

test('CreateLogObject: single line with no spaces → hard cut + ellipsis at 200, body preserved', () => {
    const text = 'x'.repeat(500);
    const req = ops.CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack(req.body.markdown);
    assert.equal(title.length, 201, 'expected 200 chars + ellipsis');
    assert.ok(title.endsWith('…'));
    assert.equal(body, text);
});

test('stripMarkdownInline: leaves filenames-with-underscores alone', () => {
    // The exact concern in the screenshot — ESA_Data_Export_Q3.xlsx must
    // not have "Data" or "Export" italicised away.
    const s = 'ESA_Data_Export_Q3.xlsx and foo_bar_baz';
    assert.equal(ops.CreateLogObject._stripMarkdownInline(s), s);
});

test('stripMarkdownInline: real italics still strip', () => {
    assert.equal(ops.CreateLogObject._stripMarkdownInline('an *italic* word'), 'an italic word');
    assert.equal(ops.CreateLogObject._stripMarkdownInline('an _italic_ word'), 'an italic word');
    assert.equal(ops.CreateLogObject._stripMarkdownInline('**bold** and `code`'), 'bold and code');
});

test('CreateLogObject: strips newlines from H1 line', () => {
    // A title should never contain literal newlines — that'd terminate the
    // heading early. Verified by escapeForH1.
    assert.equal(ops.CreateLogObject._escapeForH1('a\nb\rc'), 'a b c');
});

test('CreateLogObject: rejects blank input and missing structureId', () => {
    assert.throws(() => ops.CreateLogObject.build({ text: '', structureId: 's' }));
    assert.throws(() => ops.CreateLogObject.build({ text: '   \n', structureId: 's' }));
    assert.throws(() => ops.CreateLogObject.build({ text: 'hi' }));
});

test('CreateLogObject: shell-hostile input survives JSON round-trip', () => {
    const hostile = `A note with 'single', "double", and $HOME and \`ticks\` and \\backslashes\\ and a
newline.`;
    const req = ops.CreateLogObject.build({ text: hostile, structureId: 's' });
    const roundTripped = JSON.parse(JSON.stringify(req.body));
    // Body preserves the input verbatim (title is first line, prefixed with `# `).
    assert.ok(roundTripped.markdown.endsWith(hostile),
        `body should preserve input verbatim; got ${JSON.stringify(roundTripped.markdown)}`);
});

test('CreateLogObject: exposes _splitTitleAndBody helper', () => {
    // Round-trip through the helper directly so future callers (e.g. Alfred
    // subtitle preview) can share the exact same rule.
    assert.deepEqual(
        ops.CreateLogObject._splitTitleAndBody('short one'),
        { title: 'short one', body: null },
    );
    const long = ops.CreateLogObject._splitTitleAndBody('a '.repeat(100));
    // Plain input, no markdown → whole first line reads through (up to 200).
    assert.ok(long.title.length <= 200);
    assert.equal(long.body, 'a '.repeat(100).trim());
});

test('AppendEntityToDailyNote: EntityBlock with entityId (not entity.id) — the API rejects nested', () => {
    const req = ops.AppendEntityToDailyNote.build({ objectId: 'obj-1' });
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/blocks/daily-note/append');
    assert.deepEqual(req.body.blocks, [{ type: 'EntityBlock', entityId: 'obj-1' }]);
    assert.equal(req.body.markdown, undefined, 'must not send a hand-formatted markdown line');
});

test('AppendEntityToDailyNote: optional date passes through', () => {
    const req = ops.AppendEntityToDailyNote.build({ objectId: 'obj-1', date: '2026-09-13T00:00:00Z' });
    assert.equal(req.body.date, '2026-09-13T00:00:00Z');
});

test('AppendEntityToDailyNote: rejects missing objectId', () => {
    assert.throws(() => ops.AppendEntityToDailyNote.build({}));
});

test('DeleteObject: uses query-string id (path-form 404s in the wild)', () => {
    const req = ops.DeleteObject.build({ id: 'abc' });
    assert.equal(req.method, 'DELETE');
    assert.equal(req.path, '/object');
    assert.deepEqual(req.query, { id: 'abc' });
});

test('204-style ops parse empty body to null', () => {
    assert.equal(ops.AppendEntityToDailyNote.parse(''), null);
    assert.equal(ops.DeleteObject.parse(''), null);
});
