#!/usr/bin/env node
//
// scripts/e2e.js — live smoke test against a real Capacities test space.
// Everything is synchronous — same shape as the JXA runtime.
//
//   CAPACITIES_TOKEN=<test-space token> node scripts/e2e.js
//   node scripts/e2e.js --keep          # skip cleanup
//   node scripts/e2e.js --only=seed     # subset: bootstrap, seed
//   node scripts/e2e.js --only=retrieve # subset: bootstrap, seed, retrieve

'use strict';

const path = require('node:path');
const flows = require(path.resolve(__dirname, '..', 'flows.js'));
const { makeNodeTransport } = require(path.resolve(__dirname, '..', 'transport', 'node.js'));

const args = parseArgs(process.argv.slice(2));
const KEEP = args.keep === true;
const ONLY = args.only;

const token = process.env.CAPACITIES_TOKEN;
if (!token) fail('CAPACITIES_TOKEN not set (use a dedicated test-space token).');

const transport = makeNodeTransport({ token });
const runId = randomId(6);
// Kept small so the whole smoke test stays well under Cloudflare's per-IP
// rate limit. 3 records is enough to exercise the range-filter (record 0
// created 2s before the rest, so the 1-second window must exclude it).
const N = 3;
const seeded = [];

try {
    // The e2e smoke test just needs a structure with a `createdAt` property
    // to exercise the range filter end-to-end. In a real workspace the
    // Alfred workflow discovers a user-defined "DailyLog" content type; the
    // smoke test defaults to `RootPage` because it's always accepted, always
    // exposes createdAt, and doesn't depend on the tester's space setup.
    // Override with CAPACITIES_LOG_STRUCTURE_ID to hit a specific type.
    const forceStructureId = process.env.CAPACITIES_LOG_STRUCTURE_ID || 'RootPage';
    const bootstrap = stage('bootstrap', () => flows.setup(transport, {
        forceStructureId: forceStructureId,
    }));
    console.log(`  space=${bootstrap.space.id} structure=${bootstrap.structureId} (${bootstrap.structureTitle || '?'})`);

    stage('seed', () => seedRecords(bootstrap.structureId));

    if (ONLY === 'seed') doneOk();
    stage('retrieve', () => verifyRetrieval(bootstrap.structureId));

    if (ONLY === 'retrieve') doneOk();
    stage('daily-note-check', () => verifyDailyNote());

    if (KEEP) {
        console.log(`\n  --keep: leaving ${seeded.length} seeded objects in place.`);
        doneOk();
    }
    stage('cleanup', () => cleanupAll());
    doneOk();
} catch (e) {
    console.error(`\n\x1b[31mFAIL:\x1b[0m ${e.stack || e.message || e}`);
    if (!KEEP && seeded.length) {
        console.error(`  (${seeded.length} seeded objects still exist; rerun with --only=cleanup to remove)`);
    }
    process.exit(1);
}

function seedRecords(structureId) {
    const first = captureOne(0, structureId);
    seeded.push(first);
    sleepSync(2000);
    for (let i = 1; i < N; i++) {
        seeded.push(captureOne(i, structureId));
        sleepSync(600); // pace to stay well under Cloudflare's per-IP threshold
    }
    console.log(`  seeded ${seeded.length} records (runId=${runId})`);
}

function captureOne(i, structureId) {
    const text = `e2e-${runId}-${i}: sample capture at ${new Date().toISOString()}`;
    const { object, embedded, warning } = flows.capture(transport, { text, structureId });
    if (!embedded) throw new Error(`capture[${i}] embed failed: ${warning}`);
    return { id: object.id, text };
}

function verifyRetrieval(structureId) {
    // One list-and-hydrate pass. Two window assertions in memory.
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
    const wide = flows.listInRange(transport, { structureId, from: oneHourAgo, to: now });
    const byId = new Map(wide.map(o => [o.id, o]));

    for (const s of seeded) {
        if (!byId.has(s.id)) throw new Error(`wide window (1h) missing seeded id ${s.id}`);
    }
    console.log(`  wide window (1h): all ${N} seeded records present ✓`);

    // Narrow window: last 1 second before now must exclude the first seed
    // (which is at least ~2s older than the rest thanks to the pause in seed).
    const oneSecAgo = now.getTime() - 1000;
    const narrow = wide.filter(o => +new Date(o.createdAt) >= oneSecAgo);
    if (narrow.some(o => o.id === seeded[0].id)) {
        throw new Error('narrow window unexpectedly includes the first (older) seed');
    }
    console.log(`  narrow window (1s): ${narrow.length} results, first-seed excluded ✓`);

    for (const s of seeded) {
        const o = byId.get(s.id);
        if (!o.title || !o.title.startsWith(`e2e-${runId}-`)) {
            throw new Error(`seeded object ${o.id} title malformed: ${o.title}`);
        }
    }
}

function verifyDailyNote() {
    // The server anchors "today" to the account's local timezone, so a
    // capture near midnight UTC can land on today-UTC or tomorrow-UTC. Check
    // ±1 day and union the referenced embeds.
    const notes = flows.getDailyNotes(transport, { marginDays: 1 });
    if (notes.length === 0) throw new Error('no daily notes found in the search window');
    const referenced = new Set();
    for (const note of notes) {
        for (const section of Object.values(note.blocks || {})) {
            if (!Array.isArray(section)) continue;
            for (const b of section) {
                if (b && b.type === 'EntityBlock' && b.entityId) referenced.add(b.entityId);
            }
        }
    }
    for (const s of seeded) {
        if (!referenced.has(s.id)) throw new Error(`daily note is missing an embed for seeded id ${s.id}`);
    }
    console.log(`  daily-note: all ${seeded.length} embeds present across ${notes.length} daily note(s) ✓`);
}


function collectBlocks(root) {
    const out = [];
    const visit = (node) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (typeof node !== 'object') return;
        if (node.type) out.push(node);
        for (const k of Object.keys(node)) {
            if (k === 'type') continue;
            visit(node[k]);
        }
    };
    visit(root);
    return out;
}

function cleanupAll() {
    for (const s of seeded) {
        flows.deleteObject(transport, { id: s.id });
    }
    console.log(`  deleted ${seeded.length} objects ✓`);
}

// ---------- tiny CLI helpers ----------

function stage(name, fn) {
    process.stdout.write(`\x1b[36m→ ${name}\x1b[0m\n`);
    const t0 = Date.now();
    const out = fn();
    process.stdout.write(`  ${name} ok in ${Date.now() - t0}ms\n`);
    return out;
}

function doneOk() {
    console.log(`\n\x1b[32mPASS\x1b[0m runId=${runId}`);
    process.exit(0);
}

function fail(msg) {
    console.error(`\x1b[31mFAIL:\x1b[0m ${msg}`);
    process.exit(1);
}

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        if (a === '--keep') out.keep = true;
        else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    }
    return out;
}

function randomId(n) {
    return Math.random().toString(36).slice(2, 2 + n);
}

function sleepSync(ms) {
    // A sync sleep with no busy-wait: block on a nonexistent child that takes ms.
    require('node:child_process').execFileSync(
        process.execPath,
        ['-e', `setTimeout(()=>{}, ${ms}); setTimeout(()=>process.exit(0), ${ms})`],
        { stdio: 'ignore' },
    );
}
