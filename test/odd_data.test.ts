// test/odd_data.test.ts — rigorous edge case and odd data tests for desktop OS environment.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    splitTitleAndBody,
    stripMarkdownInline,
    escapeForH1,
    CreateLogObject,
} from '../src/ops.ts';
import {
    parseRangeExpression,
    filterByDate,
    truncate,
    ApiError,
    run,
} from '../src/runner.ts';
import { readProperty, capture } from '../src/flows.ts';
import { formatWhen, alfredError, alfredEmpty, saveConfig } from '../src/jxa-utils.ts';
import { makeMockTransport } from '../src/transport/mock.ts';

test('odd data: Unicode, emojis and multilingual characters', () => {
    // Emojis, flags, CJK, Cyrillic, Arabic, accented Latin, symbols
    const complex = '🚀 Meeting with André & 张伟 on «AI безопасность» — 100% finished! 🎯';
    const split = splitTitleAndBody(complex);
    assert.equal(split.title, complex);
    assert.equal(split.body, complex); // > 60 chars, so body preserves input

    // Short unicode (< 60 chars) fits in title alone with null body
    const shortUnicode = '🚀 Quick note with André & 张伟 🎯';
    const splitShort = splitTitleAndBody(shortUnicode);
    assert.equal(splitShort.title, shortUnicode);
    assert.equal(splitShort.body, null);

    // Multi-line with emoji
    const multiline = '🔥 Urgent Fix\n\nFixing database deadlock in production';
    const split2 = splitTitleAndBody(multiline);
    assert.equal(split2.title, '🔥 Urgent Fix');
    assert.equal(split2.body, multiline);

    // RTL and mixed scripts
    const rtl = 'مرحبا بالعالم (Hello World) in RTL';
    assert.equal(splitTitleAndBody(rtl).title, rtl);
});

test('odd data: shell-hostile characters, escapes and quotes', () => {
    const hostile = `$(whoami) && rm -rf /; echo "quotes" 'single' \`backticks\` \\backslash\\ \${VARIABLE} > /dev/null & | ;`;
    const req = CreateLogObject.build({ text: hostile, structureId: 'struct-1' });
    const markdown = (req.body as any).markdown;

    // Must be safely enclosed in the markdown body
    assert.ok(markdown.includes(hostile));
    // Escaped title should not have newlines
    assert.ok(!markdown.split('\n')[0].includes('\n'));
});

test('odd data: Windows CRLF and trailing/leading whitespace', () => {
    const crlf = 'First Line\r\n\r\nSecond Paragraph with detail\r\nThird Line';
    const split = splitTitleAndBody(crlf);
    assert.equal(split.title, 'First Line');
    assert.equal(split.body, crlf.trim());

    // Lots of whitespace
    const whitespace = '   \t  Padded Title   \t   \n\nBody content   ';
    const splitWs = splitTitleAndBody(whitespace);
    assert.equal(splitWs.title, 'Padded Title');
    assert.equal(splitWs.body, whitespace.trim());
});

test('odd data: complex filenames with underscores and dots', () => {
    // Should NOT strip underscores from filenames
    const text = 'Reviewing Q3_Financial_Export_v2.0_FINAL.xlsx and db_backup_2026_09.tar.gz';
    assert.equal(stripMarkdownInline(text), text);

    const longWithFile = 'Reviewing Q3_Financial_Export_v2.0_FINAL.xlsx and db_backup_2026_09.tar.gz with team members for approval.';
    const split = splitTitleAndBody(longWithFile);
    assert.ok(split.title.includes('Q3_Financial_Export_v2.0_FINAL.xlsx'));
    assert.ok(split.title.includes('db_backup_2026_09.tar.gz'));
});

test('odd data: broken and nested markdown constructs', () => {
    // Unclosed markdown
    assert.equal(stripMarkdownInline('**unclosed bold'), '**unclosed bold');
    assert.equal(stripMarkdownInline('*unclosed italic'), '*unclosed italic');
    assert.equal(stripMarkdownInline('~~unclosed strike'), '~~unclosed strike');
    assert.equal(stripMarkdownInline('[unclosed link](http://example.com'), '[unclosed link](http://example.com');

    // Broken image vs real image
    assert.equal(stripMarkdownInline('![alt text](https://example.com/pic.png)'), 'alt text');
    assert.equal(stripMarkdownInline('![broken image'), '![broken image');

    // Reference style links
    assert.equal(stripMarkdownInline('[Google][1] reference link'), 'Google reference link');

    // Code with backticks
    assert.equal(stripMarkdownInline('Run `npm test -- --bail` now'), 'Run npm test -- --bail now');
});

test('odd data: massive strings (10,000+ chars)', () => {
    // 10,000 characters without spaces
    const massiveNoSpaces = 'a'.repeat(10000);
    const splitNoSpace = splitTitleAndBody(massiveNoSpaces);
    assert.equal(splitNoSpace.title.length, 201); // 200 + ellipsis
    assert.ok(splitNoSpace.title.endsWith('…'));
    assert.equal(splitNoSpace.body?.length, 10000);

    // 10,000 characters with words
    const massiveWords = ('word '.repeat(2000)).trim();
    const splitWords = splitTitleAndBody(massiveWords);
    assert.ok(splitWords.title.length <= 201);
    assert.ok(splitWords.title.endsWith('…'));
    assert.equal(splitWords.body, massiveWords);
});

test('odd data: date range parser edge cases', () => {
    const fixedNow = new Date('2026-09-15T12:00:00.000Z');

    // Leap day in a leap year (2024 was leap year)
    const leapRange = parseRangeExpression('2024-02-28..2024-02-29', fixedNow);
    assert.equal(leapRange.from.toISOString(), '2024-02-28T00:00:00.000Z');
    assert.equal(leapRange.to.toISOString(), '2024-03-01T00:00:00.000Z');

    // Year boundary
    const yearBoundary = parseRangeExpression('2025-12-31..2026-01-01', fixedNow);
    assert.equal(yearBoundary.from.toISOString(), '2025-12-31T00:00:00.000Z');
    assert.equal(yearBoundary.to.toISOString(), '2026-01-02T00:00:00.000Z');

    // Maximum allowed N (3650 days = 10 years)
    const maxN = parseRangeExpression('3650', fixedNow);
    const diffDays = Math.round((maxN.to.getTime() - maxN.from.getTime()) / 86400000);
    assert.equal(diffDays, 3650);

    // Negative, zero, or exceeding max N
    assert.throws(() => parseRangeExpression('0', fixedNow));
    assert.throws(() => parseRangeExpression('-5', fixedNow));
    assert.throws(() => parseRangeExpression('3651', fixedNow));

    // Invalid calendar dates like Feb 30th
    assert.throws(() => parseRangeExpression('2026-02-30..2026-03-01', fixedNow));
});

test('odd data: date formatting for Alfred UI', () => {
    assert.equal(formatWhen('not-a-valid-date'), 'not-a-valid-date');
    const formatted = formatWhen('2026-09-13T15:47:00Z');
    assert.match(formatted, /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
});

test('odd data: readProperty envelope corner cases', () => {
    // Missing object or empty properties
    assert.equal(readProperty(undefined, 'title'), undefined);
    assert.equal(readProperty({} as any, 'title'), undefined);
    assert.equal(readProperty({ id: '1', properties: undefined }, 'title'), undefined);

    // Object with null property value
    assert.equal(readProperty({ id: '1', properties: { title: null } }, 'title'), undefined);

    // Malformed property without value key
    assert.deepEqual(
        readProperty({ id: '1', properties: { title: { type: 'title' } } }, 'title'),
        { type: 'title' },
    );

    // Primitive number property
    assert.equal(
        readProperty({ id: '1', properties: { count: { type: 'number', number: { value: 42 } } } }, 'count'),
        42,
    );
});

test('odd data: error truncation prevents Alfred UI overflow', () => {
    const hugeBody = 'Error details: ' + 'x'.repeat(10000);
    const err = new ApiError('TestOp', 500, hugeBody);
    // Error message must be truncated to avoid breaking Alfred's alert modal
    assert.ok(err.message.length < 500);
    assert.ok(err.message.includes('…'));
    assert.equal(err.body, hugeBody); // full body retained on instance
});

test('odd data: capture flow with characters needing JSON escaping', () => {
    const t = makeMockTransport({
        'POST /object/markdown': { status: 200, text: '{"id":"esc-1","title":"ok"}' },
        'POST /blocks/daily-note/append': { status: 204, text: '' },
    });
    const weirdText = 'Note with \b backspace \f formfeed \0 null \u001b[31m ansi \u001b[0m';
    const res = capture(t, { text: weirdText, structureId: 'struct-1' });
    assert.equal(res.embedded, true);
    assert.equal(res.object.id, 'esc-1');
});

test('jxa-utils: alfredError and alfredEmpty generate valid JSON for Alfred', () => {
    const errJson = JSON.parse(alfredError('Missing Token', 'Please set CAPACITIES_TOKEN'));
    assert.equal(errJson.items.length, 1);
    assert.equal(errJson.items[0].title, 'Missing Token');
    assert.equal(errJson.items[0].valid, false);

    const emptyJson = JSON.parse(alfredEmpty(new Date('2026-09-01'), new Date('2026-09-08')));
    assert.equal(emptyJson.items.length, 1);
    assert.equal(emptyJson.items[0].title, 'No captures in range');
    assert.equal(emptyJson.items[0].valid, false);

    // saveConfig propagates failure when Alfred is unavailable
    assert.throws(
        () => saveConfig('TEST_KEY', 'TEST_VAL'),
        /Failed to save configuration 'TEST_KEY' in Alfred/,
    );
});

test('runner: handles malformed transport responses and parse failures', () => {
    const dummyOp = {
        name: 'DummyOp',
        build: () => ({ method: 'GET' as const, path: '/test' }),
        parse: (t: string) => {
            if (t === 'bad-json') throw new Error('invalid JSON payload');
            return JSON.parse(t);
        },
    };

    // Malformed transport response (no status)
    assert.throws(
        () => run(dummyOp, {}, (() => null as any)),
        /transport returned malformed response/,
    );
    assert.throws(
        () => run(dummyOp, {}, (() => ({ status: '200' } as any))),
        /transport returned malformed response/,
    );

    // Parse failure handling
    assert.throws(
        () => run(dummyOp, {}, (() => ({ status: 200, text: 'bad-json' }))),
        /failed to parse response — invalid JSON payload/,
    );
});
