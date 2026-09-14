// transport/mock.js — test transport. Records every request and returns
// canned responses from a fixture map keyed by "METHOD path".
//
// Usage:
//   const t = makeMockTransport({
//     'GET /space':               { status: 200, text: '{"id":"sp1","title":"My"}' },
//     'POST /object/markdown':    { status: 200, text: '{"id":"obj1"}' },
//     'POST /blocks/daily-note/append': { status: 204, text: '' },
//   });
//   await run(op, input, t);
//   t.calls  // → [{method, path, body, query}, ...]

(function (root) {
    'use strict';

    function makeMockTransport(fixtures, opts) {
        opts = opts || {};
        const calls = [];

        function transport(req) {
            const record = {
                method: req.method,
                path: req.path,
                body: req.body,
                query: req.query,
                headers: req.headers,
            };
            calls.push(record);
            const key = `${req.method} ${req.path}`;
            const fixture = fixtures[key];
            if (fixture == null) {
                if (opts.strict === false) return { status: 200, text: '' };
                throw new Error(`mockTransport: no fixture for "${key}"`);
            }
            if (typeof fixture === 'function') return fixture(req, calls.length - 1);
            return fixture;
        }

        transport.calls = calls;
        transport.callsFor = (method, path) =>
            calls.filter(c => c.method === method && c.path === path);
        return transport;
    }

    const api = { makeMockTransport };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.mockTransport = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
