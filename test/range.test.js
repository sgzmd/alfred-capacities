// test/range.test.js — parseRangeExpression + filterByDate.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRangeExpression, filterByDate } = require('../runner.js');

const NOW = new Date('2026-09-13T12:00:00Z');

test('parseRangeExpression: empty and "week" both mean last 7 days', () => {
    for (const input of ['', undefined, null, 'week', 'WEEK', ' week ']) {
        const r = parseRangeExpression(input, NOW);
        assert.equal(r.to.toISOString(), NOW.toISOString());
        const diffDays = Math.round((r.to - r.from) / 86400000);
        assert.equal(diffDays, 7, `expected 7-day window for ${JSON.stringify(input)}`);
    }
});

test('parseRangeExpression: "today" is midnight-UTC to now', () => {
    const r = parseRangeExpression('today', NOW);
    assert.equal(r.from.toISOString(), '2026-09-13T00:00:00.000Z');
    assert.equal(r.to.toISOString(), NOW.toISOString());
});

test('parseRangeExpression: numeric N', () => {
    const r = parseRangeExpression('3', NOW);
    const diffDays = Math.round((r.to - r.from) / 86400000);
    assert.equal(diffDays, 3);
});

test('parseRangeExpression: ISO range is inclusive on both ends (end + 1d exclusive)', () => {
    const r = parseRangeExpression('2026-09-01..2026-09-07', NOW);
    assert.equal(r.from.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(r.to.toISOString(), '2026-09-08T00:00:00.000Z');
});

test('parseRangeExpression: rejects garbage', () => {
    for (const bad of ['xyz', '0', '-1', '9999', '2026-09-01..2026-08-01']) {
        assert.throws(() => parseRangeExpression(bad, NOW), new RegExp('range'));
    }
});

test('filterByDate: from-inclusive, to-exclusive; sorts newest first; ignores bad dates', () => {
    const items = [
        { id: 'a', createdAt: '2026-09-10T10:00:00Z' },
        { id: 'b', createdAt: '2026-09-11T10:00:00Z' },
        { id: 'c', createdAt: '2026-09-12T10:00:00Z' },
        { id: 'boundary-from', createdAt: '2026-09-10T00:00:00Z' },
        { id: 'boundary-to', createdAt: '2026-09-13T00:00:00Z' },
        { id: 'bad', createdAt: 'nope' },
    ];
    const out = filterByDate(items, {
        from: new Date('2026-09-10T00:00:00Z'),
        to: new Date('2026-09-13T00:00:00Z'),
    });
    assert.deepEqual(out.map(o => o.id), ['c', 'b', 'a', 'boundary-from']);
});

test('filterByDate: handles null/undefined input gracefully', () => {
    assert.deepEqual(filterByDate(null, { from: new Date(0), to: new Date(1e13) }), []);
    assert.deepEqual(filterByDate(undefined, { from: new Date(0), to: new Date(1e13) }), []);
});
