// test/transport.test.js — the Node transport wraps requests correctly.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { makeNodeTransport, API_VERSION } = require('../transport/node.js');
const { makeMockTransport } = require('../transport/mock.js');

// Build a shim curl on PATH that echoes stdin/argv back so we can inspect the
// request without hitting the network.
const os = require('node:os');
const fs = require('node:fs');

function withShimmedCurl(fn) {
    return (t) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curl-shim-'));
        const shim = path.join(dir, 'curl');
        // The shim writes argv to a sidecar file and prints a canned body + a
        // status suffix matching the format nodeTransport parses.
        fs.writeFileSync(shim, [
            '#!/usr/bin/env node',
            'const fs = require("fs");',
            'const argv = process.argv.slice(2);',
            'fs.writeFileSync(process.env.CURL_SHIM_LOG, JSON.stringify(argv));',
            'process.stdout.write("{\\"ok\\":true}\\n__HTTP_STATUS__:200");',
        ].join('\n'), { mode: 0o755 });
        const log = path.join(dir, 'log.json');
        const origPath = process.env.PATH;
        process.env.PATH = dir + ':' + origPath;
        process.env.CURL_SHIM_LOG = log;
        try {
            fn(t, () => JSON.parse(fs.readFileSync(log, 'utf8')));
        } finally {
            process.env.PATH = origPath;
            delete process.env.CURL_SHIM_LOG;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

test('makeNodeTransport: token required', () => {
    assert.throws(() => makeNodeTransport({}));
});

test('makeNodeTransport: attaches bearer + version + accept headers', withShimmedCurl((t, readArgs) => {
    const transport = makeNodeTransport({ token: 't0k', baseUrl: 'https://api.capacities.io' });
    const res = transport({ method: 'GET', path: '/space' });
    assert.equal(res.status, 200);
    assert.equal(res.text, '{"ok":true}');
    const args = readArgs();
    assert.ok(args.includes('Authorization: Bearer t0k'));
    assert.ok(args.includes(`Capacities-API-Version: ${API_VERSION}`));
    assert.ok(args.includes('Accept: application/json'));
    assert.ok(args.includes('-X'));
    assert.ok(args.includes('GET'));
    assert.ok(args.some(a => a === 'https://api.capacities.io/space'));
}));

test('makeNodeTransport: JSON-encodes bodies and adds Content-Type', withShimmedCurl((t, readArgs) => {
    const transport = makeNodeTransport({ token: 't', baseUrl: 'https://api.capacities.io' });
    transport({ method: 'POST', path: '/object', body: { hello: 'world' } });
    const args = readArgs();
    assert.ok(args.includes('Content-Type: application/json'));
    const dataIx = args.indexOf('--data-binary');
    assert.ok(dataIx >= 0);
    assert.deepEqual(JSON.parse(args[dataIx + 1]), { hello: 'world' });
}));

test('makeNodeTransport: query params get URL-encoded', withShimmedCurl((t, readArgs) => {
    const transport = makeNodeTransport({ token: 't', baseUrl: 'https://api.capacities.io' });
    transport({
        method: 'GET',
        path: '/objects/tag',
        query: { tag: 'a b', extra: 42, ignored: null },
    });
    const args = readArgs();
    const url = args[args.length - 1];
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/objects/tag');
    assert.equal(parsed.searchParams.get('tag'), 'a b');
    assert.equal(parsed.searchParams.get('extra'), '42');
    assert.equal(parsed.searchParams.has('ignored'), false);
}));

test('makeMockTransport: records calls and returns fixtures by "METHOD path"', () => {
    const t = makeMockTransport({
        'GET /space': { status: 200, text: '{"id":"s1"}' },
    });
    const res = t({ method: 'GET', path: '/space' });
    assert.deepEqual(res, { status: 200, text: '{"id":"s1"}' });
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].path, '/space');
});

test('makeMockTransport: throws on missing fixture by default', () => {
    const t = makeMockTransport({});
    assert.throws(() => t({ method: 'GET', path: '/unknown' }), /no fixture/);
});

test('makeMockTransport: fixture may be a function taking (req, callIndex)', () => {
    const t = makeMockTransport({
        'GET /space': (req, idx) => ({ status: 200, text: JSON.stringify({ idx }) }),
    });
    const a = t({ method: 'GET', path: '/space' });
    const b = t({ method: 'GET', path: '/space' });
    assert.equal(JSON.parse(a.text).idx, 0);
    assert.equal(JSON.parse(b.text).idx, 1);
});
