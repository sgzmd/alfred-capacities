// test/ops.test.ts — every op's build/parse contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GetSpace,
    ListStructures,
    ListObjectsByStructure,
    GetObject,
    SearchObjects,
    CreateLogObject,
    AppendEntityToDailyNote,
    DeleteObject,
    splitTitleAndBody,
    stripMarkdownInline,
    escapeForH1,
} from '../src/ops.ts';

// Helper: parse the H1 title back out of a `# <title>\n\n<body>` markdown string.
function splitBack(md: string): { title: string; body?: string } {
    const m = md.match(/^# (.*?)(?:\n\n([\s\S]*))?$/);
    if (!m) throw new Error(`Could not parse H1 markdown: ${md}`);
    return { title: m[1], body: m[2] };
}

test('GetSpace: GET /space, no body', () => {
    const req = GetSpace.build({});
    assert.deepEqual(req, { method: 'GET', path: '/space' });
    assert.deepEqual(GetSpace.parse('{"id":"sp1","title":"Home"}'), { id: 'sp1', title: 'Home' });
});

test('ListStructures: GET /space/structures', () => {
    const req = ListStructures.build({});
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/space/structures');
});

test('ListObjectsByStructure: uses ?id= query on /objects/structure', () => {
    const req = ListObjectsByStructure.build({ structureId: 'struct-abc' });
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/objects/structure');
    assert.deepEqual(req.query, { id: 'struct-abc' });
    assert.equal(req.body, undefined);
});

test('GetObject: uses ?id= query', () => {
    const req = GetObject.build({ id: 'obj-xyz' });
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/object');
    assert.deepEqual(req.query, { id: 'obj-xyz' });
});

test('SearchObjects: POST /objects/search with optional structureIds', () => {
    assert.deepEqual(
        (SearchObjects.build({ query: 'DailyLog' }).body as any),
        { query: 'DailyLog' },
    );
    assert.deepEqual(
        (SearchObjects.build({ query: 'DailyLog', structureIds: ['RootTag'] }).body as any),
        { query: 'DailyLog', structureIds: ['RootTag'] },
    );
});

test('CreateLogObject: uses POST /object/markdown with H1-prefixed title', () => {
    const req = CreateLogObject.build({
        text: 'Short note',
        structureId: 'log-struct-uuid',
    });
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/object/markdown');
    const body = req.body as any;
    assert.equal(body.spaceId, undefined, 'spaceId must not appear in v1 payload');
    assert.equal(body.mdText, undefined);
    assert.equal(body.structureId, 'log-struct-uuid');
    assert.equal(body.markdown, '# Short note');
    assert.equal(body.properties, undefined);
});

test('CreateLogObject: short single-line input → H1-only markdown, no body', () => {
    const req = CreateLogObject.build({ text: 'Hello world', structureId: 's' });
    const body = req.body as any;
    assert.equal(body.markdown, '# Hello world');
    assert.equal(splitBack(body.markdown).body, undefined);
});

test('CreateLogObject: long input with markdown link → title stripped to plain text; body keeps markdown', () => {
    const text = 'Updating [ESA_Data_Export_Q3.xlsx](https://coupangnam-my.sharepoint.com/foo/bar) with Requirements and Capabilities for ATO work going forward.';
    const req = CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack((req.body as any).markdown);
    assert.equal(
        title,
        'Updating ESA_Data_Export_Q3.xlsx with Requirements and Capabilities for ATO work going forward.',
    );
    assert.equal(body, text, 'body preserves the raw markdown link verbatim');
});

test('CreateLogObject: long plain input → no stripping needed; whole line becomes the title', () => {
    const text = 'Updating the deploy plan for Q3 with a lot of context that makes this line longer than sixty characters.';
    const req = CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack((req.body as any).markdown);
    assert.equal(title, text);
    assert.equal(body, text);
});

test('CreateLogObject: multiline input → title = first line, body = full text', () => {
    const text = 'First line summary\n\nSecond paragraph with detail.';
    const req = CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack((req.body as any).markdown);
    assert.equal(title, 'First line summary');
    assert.equal(body, text);
});

test('CreateLogObject: absurdly long input → 200-char word-boundary trim', () => {
    const text = ('word '.repeat(120)).trim();
    const req = CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack((req.body as any).markdown);
    assert.ok(title.length <= 201, `title too long: ${title.length}`);
    assert.ok(title.endsWith('…'));
    assert.equal(body, text);
});

test('CreateLogObject: single line with no spaces → hard cut + ellipsis at 200, body preserved', () => {
    const text = 'x'.repeat(500);
    const req = CreateLogObject.build({ text, structureId: 's' });
    const { title, body } = splitBack((req.body as any).markdown);
    assert.equal(title.length, 201, 'expected 200 chars + ellipsis');
    assert.ok(title.endsWith('…'));
    assert.equal(body, text);
});

test('stripMarkdownInline: leaves filenames-with-underscores alone', () => {
    const s = 'ESA_Data_Export_Q3.xlsx and foo_bar_baz';
    assert.equal(stripMarkdownInline(s), s);
});

test('stripMarkdownInline: real italics still strip', () => {
    assert.equal(stripMarkdownInline('an *italic* word'), 'an italic word');
    assert.equal(stripMarkdownInline('an _italic_ word'), 'an italic word');
    assert.equal(stripMarkdownInline('**bold** and `code`'), 'bold and code');
    assert.equal(stripMarkdownInline('~~struck~~ and ![img](https://example.com/pic.png)'), 'struck and img');
});

test('CreateLogObject: strips newlines from H1 line', () => {
    assert.equal(escapeForH1('a\nb\rc'), 'a b c');
    assert.equal(escapeForH1('a\r\n\r\nb'), 'a b');
});

test('CreateLogObject: rejects blank input and missing structureId', () => {
    assert.throws(() => CreateLogObject.build({ text: '', structureId: 's' }));
    assert.throws(() => CreateLogObject.build({ text: '   \n', structureId: 's' }));
    assert.throws(() => CreateLogObject.build({ text: 'hi', structureId: '' }));
});

test('CreateLogObject: shell-hostile input survives JSON round-trip', () => {
    const hostile = `A note with 'single', "double", and $HOME and \`ticks\` and \\backslashes\\ and a\nnewline.`;
    const req = CreateLogObject.build({ text: hostile, structureId: 's' });
    const roundTripped = JSON.parse(JSON.stringify(req.body));
    assert.ok(roundTripped.markdown.endsWith(hostile));
});

test('splitTitleAndBody: helper behaves as expected', () => {
    assert.deepEqual(splitTitleAndBody('short one'), { title: 'short one', body: null });
    const long = splitTitleAndBody('a '.repeat(100));
    assert.ok(long.title.length <= 200);
    assert.equal(long.body, 'a '.repeat(100).trim());
});

test('AppendEntityToDailyNote: EntityBlock with entityId', () => {
    const req = AppendEntityToDailyNote.build({ objectId: 'obj-1' });
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/blocks/daily-note/append');
    assert.deepEqual((req.body as any).blocks, [{ type: 'EntityBlock', entityId: 'obj-1' }]);
});

test('AppendEntityToDailyNote: optional date passes through', () => {
    const req = AppendEntityToDailyNote.build({ objectId: 'obj-1', date: '2026-09-13T00:00:00Z' });
    assert.equal((req.body as any).date, '2026-09-13T00:00:00Z');
});

test('AppendEntityToDailyNote: rejects missing objectId', () => {
    assert.throws(() => AppendEntityToDailyNote.build({ objectId: '' }));
});

test('DeleteObject: uses query-string id', () => {
    const req = DeleteObject.build({ id: 'abc' });
    assert.equal(req.method, 'DELETE');
    assert.equal(req.path, '/object');
    assert.deepEqual(req.query, { id: 'abc' });
});

test('204-style ops parse empty body to null', () => {
    assert.equal(AppendEntityToDailyNote.parse(''), null);
    assert.equal(DeleteObject.parse(''), null);
});
