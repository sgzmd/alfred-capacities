#!/usr/bin/env node
//
// scripts/dev.js — maintenance CLI for a Capacities test space. Reuses ops,
// flows and the Node transport so it stays in lock-step with the workflow.
//
// Usage:
//   CAPACITIES_TOKEN=… node scripts/dev.js list                  # every DailyLog capture
//   CAPACITIES_TOKEN=… node scripts/dev.js list --prefix=e2e-    # filter by title prefix
//   CAPACITIES_TOKEN=… node scripts/dev.js clean                 # DELETE all DailyLog captures
//   CAPACITIES_TOKEN=… node scripts/dev.js clean --prefix=e2e-   # DELETE only e2e leftovers
//   CAPACITIES_TOKEN=… node scripts/dev.js clean --dry-run       # print what would be deleted
//   CAPACITIES_TOKEN=… node scripts/dev.js delete <id> [<id>...]
//   CAPACITIES_TOKEN=… node scripts/dev.js get <id>              # full object JSON
//   CAPACITIES_TOKEN=… node scripts/dev.js structures            # list structures in space
//   CAPACITIES_TOKEN=… node scripts/dev.js curl GET /space       # raw request
//
// Env override: CAPACITIES_LOG_STRUCTURE_ID skips setup's auto-discovery
// (useful against bare test spaces that don't have a "DailyLog" content type).

'use strict';

const path = require('node:path');
const flows = require(path.resolve(__dirname, '..', 'flows.js'));
const ops = require(path.resolve(__dirname, '..', 'ops.js'));
const runner = require(path.resolve(__dirname, '..', 'runner.js'));
const { makeNodeTransport } = require(path.resolve(__dirname, '..', 'transport', 'node.js'));

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = parseFlags(argv.slice(1));
const rest = argv.slice(1).filter(a => !a.startsWith('--'));

const token = process.env.CAPACITIES_TOKEN;
if (!token) die('CAPACITIES_TOKEN not set.');
const transport = makeNodeTransport({ token });

const commands = {
    list: listCaptures,
    clean: cleanCaptures,
    delete: deleteById,
    get: getObject,
    structures: listStructures,
    curl: rawRequest,
    help: printHelp,
};

if (!cmd || !commands[cmd]) {
    if (cmd) console.error(`unknown command: ${cmd}\n`);
    printHelp();
    process.exit(cmd ? 1 : 0);
}

try {
    commands[cmd]();
} catch (e) {
    die(e.stack || e.message || String(e));
}

// ---------- commands ----------

function listCaptures() {
    const captures = fetchCaptures();
    if (captures.length === 0) { console.log('(no captures)'); return; }
    for (const o of captures) {
        console.log(`${o.id}  ${(o.createdAt || '').padEnd(24)}  ${o.title}`);
    }
    console.log(`\n${captures.length} object(s).`);
}

function cleanCaptures() {
    const captures = fetchCaptures();
    if (captures.length === 0) { console.log('nothing to delete.'); return; }
    console.log(`Found ${captures.length} object(s):`);
    for (const o of captures) console.log(`  ${o.id}  ${o.title}`);
    if (flags['dry-run']) { console.log('\n(dry-run — not deleting)'); return; }
    let ok = 0, fail = 0;
    for (const o of captures) {
        try {
            runner.run(ops.DeleteObject, { id: o.id }, transport);
            process.stdout.write('.');
            ok++;
        } catch (e) {
            process.stdout.write('x');
            fail++;
            console.error(`\n  ${o.id}: ${e.message}`);
        }
    }
    console.log(`\n${ok} deleted, ${fail} failed.`);
}

function deleteById() {
    if (rest.length === 0) die('delete: give at least one object id.');
    for (const id of rest) {
        try {
            runner.run(ops.DeleteObject, { id }, transport);
            console.log(`${id} → deleted`);
        } catch (e) {
            console.log(`${id} → ${e.message}`);
        }
    }
}

function getObject() {
    if (rest.length !== 1) die('get: give exactly one id.');
    const full = runner.run(ops.GetObject, { id: rest[0] }, transport);
    console.log(JSON.stringify(full, null, 2));
}

function listStructures() {
    const resp = runner.run(ops.ListStructures, {}, transport);
    const list = (resp && (resp.structures || resp)) || [];
    for (const s of list) console.log(`${(s.id || '').padEnd(24)}  ${s.title || ''}`);
}

function rawRequest() {
    // scripts/dev.js curl METHOD PATH [json-body]
    const method = rest[0];
    const p = rest[1];
    const body = rest[2];
    if (!method || !p) die('curl: usage: curl METHOD /path [json-body]');
    const req = { method, path: p };
    if (body) req.body = JSON.parse(body);
    const res = transport(req);
    console.log(`HTTP ${res.status}`);
    console.log(res.text);
}

// ---------- helpers ----------

function fetchCaptures() {
    // Bootstrap to discover the log structure id (idempotent), then list + hydrate.
    const forceStructureId = process.env.CAPACITIES_LOG_STRUCTURE_ID || undefined;
    const { structureId } = flows.setup(transport, {
        forceStructureId: forceStructureId,
    });
    const wide = flows.listInRange(transport, {
        structureId: structureId,
        from: new Date(0),
        to: new Date('9999-01-01T00:00:00Z'),
    });
    const prefix = flags.prefix;
    return prefix ? wide.filter(o => (o.title || '').startsWith(prefix)) : wide;
}

function parseFlags(args) {
    const out = {};
    for (const a of args) {
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
        else out[a.slice(2)] = true;
    }
    return out;
}

function die(msg) {
    console.error(`\x1b[31m${msg}\x1b[0m`);
    process.exit(1);
}

function printHelp() {
    console.log(`
Maintenance CLI for the alfred-capacities test space.
All commands require CAPACITIES_TOKEN.

  list                       every DailyLog-tagged object, sorted newest first
  list --prefix=STR          only titles starting with STR
  clean                      DELETE every DailyLog-tagged object
  clean --prefix=e2e-        DELETE only the e2e leftovers
  clean --dry-run            print what would be deleted
  delete <id> [<id>...]      DELETE these ids
  get <id>                   full object JSON (properties, blocks, …)
  structures                 list structures in the space
  curl METHOD /path [body]   raw request through the same transport
`.trim());
}
