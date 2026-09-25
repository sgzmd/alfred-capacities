#!/usr/bin/env node
//
// scripts/dev.ts — maintenance CLI for a Capacities test space. Reuses ops,
// flows and the Node transport so it stays in lock-step with the workflow.
//
// Usage:
//   node scripts/dev.ts list                  # every DailyLog capture
//   node scripts/dev.ts list --prefix=e2e-    # filter by title prefix
//   node scripts/dev.ts clean                 # DELETE all DailyLog captures
//   node scripts/dev.ts clean --prefix=e2e-   # DELETE only e2e leftovers
//   node scripts/dev.ts clean --dry-run       # print what would be deleted
//   node scripts/dev.ts delete <id> [<id>...]
//   node scripts/dev.ts get <id>              # full object JSON
//   node scripts/dev.ts structures            # list structures in space
//   node scripts/dev.ts curl GET /space       # raw request
//
// Env override: CAPACITIES_LOG_STRUCTURE_ID skips setup's auto-discovery
// (useful against bare test spaces that don't have a "DailyLog" content type).

import * as flows from '../src/flows.ts';
import * as ops from '../src/ops.ts';
import * as runner from '../src/runner.ts';
import { makeNodeTransport } from '../src/transport/node.ts';
import { loadEnvToken } from './env.ts';

const token = loadEnvToken(import.meta.url);
if (!token) die('CAPACITIES_TOKEN not set.');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = parseFlags(argv.slice(1));
const rest = argv.slice(1).filter(a => !a.startsWith('--'));
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

if (!cmd || !(cmd in commands)) {
    if (cmd) console.error(`unknown command: ${cmd}\n`);
    printHelp();
    process.exit(cmd ? 1 : 0);
}

try {
    commands[cmd as keyof typeof commands]();
} catch (e: any) {
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
        } catch (e: any) {
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
        } catch (e: any) {
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
    const list = resp?.structures || [];
    for (const s of list) console.log(`${(s.id || '').padEnd(24)}  ${s.title || ''}`);
}

function rawRequest() {
    const method = rest[0] as any;
    const p = rest[1];
    const body = rest[2];
    if (!method || !p) die('curl: usage: curl METHOD /path [json-body]');
    const req: any = { method, path: p };
    if (body) req.body = JSON.parse(body);
    const res = transport(req);
    console.log(`HTTP ${res.status}`);
    console.log(res.text);
}

// ---------- helpers ----------

function fetchCaptures() {
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

function parseFlags(args: string[]) {
    const out: Record<string, any> = {};
    for (const a of args) {
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
        else out[a.slice(2)] = true;
    }
    return out;
}

function die(msg: string): never {
    console.error(`\x1b[31m${msg}\x1b[0m`);
    process.exit(1);
}

function printHelp() {
    console.log(`
Maintenance CLI for the alfred-capacities space.
Requires CAPACITIES_TOKEN (read automatically from .env if present).

  list                       every DailyLog object, sorted newest first
  list --prefix=STR          only titles starting with STR
  clean                      DELETE every DailyLog object
  clean --prefix=e2e-        DELETE only the e2e leftovers
  clean --dry-run            print what would be deleted
  delete <id> [<id>...]      DELETE these ids
  get <id>                   full object JSON (properties, blocks, …)
  structures                 list structures in the space
  curl METHOD /path [body]   raw request through the same transport
`.trim());
}
