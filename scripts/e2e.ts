#!/usr/bin/env node
//
// scripts/e2e.js — live smoke test against a real Capacities test space.
// Everything is synchronous — same shape as the JXA runtime.
//
//   node scripts/e2e.js
//   node scripts/e2e.js --keep          # skip cleanup
//   node scripts/e2e.js --only=seed     # subset: bootstrap, seed
//   node scripts/e2e.js --only=retrieve # subset: bootstrap, seed, retrieve

import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as flows from '../src/flows.ts';
import { makeNodeTransport } from '../src/transport/node.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Auto-load token from sibling .env if not explicitly set in environment
if (!process.env.CAPACITIES_TOKEN) {
    const envFile = path.resolve(__dirname, '..', '.env');
    if (fs.existsSync(envFile)) {
        const m = fs.readFileSync(envFile, 'utf8').match(/^CAPACITIES_TOKEN=(.*)$/m);
        if (m) process.env.CAPACITIES_TOKEN = m[1].trim();
    }
}

const args = parseArgs(process.argv.slice(2));
const KEEP = args.keep === true;
const ONLY = args.only;

const token = process.env.CAPACITIES_TOKEN;
if (!token) fail('CAPACITIES_TOKEN not set (use a dedicated test-space token or .env).');

const transport = makeNodeTransport({ token });
const runId = randomId(6);
const N = 3;
const seeded: Array<{ id: string; text: string }> = [];

try {
    const forceStructureId = process.env.CAPACITIES_LOG_STRUCTURE_ID;
    let bootstrap: { space: any; structureId: string; structureTitle: string };
    try {
        bootstrap = stage('bootstrap', () => flows.setup(transport, { forceStructureId }));
    } catch {
        bootstrap = stage('bootstrap (fallback RootPage)', () => flows.setup(transport, { forceStructureId: 'RootPage' }));
    }
    console.log(`  space=${bootstrap.space.id} structure=${bootstrap.structureId} (${bootstrap.structureTitle || '?'})`);

    stage('seed', () => seedRecords(bootstrap.structureId));

    if (ONLY === 'seed') doneOk();
    sleepSync(2000);
    stage('retrieve', () => verifyRetrieval(bootstrap.structureId));

    if (ONLY === 'retrieve') doneOk();
    sleepSync(2000);
    stage('daily-note-check', () => verifyDailyNote());

    if (KEEP) {
        console.log(`\n  --keep: leaving ${seeded.length} seeded objects in place.`);
        doneOk();
    }
    stage('cleanup', () => cleanupAll());
    doneOk();
} catch (e: any) {
    console.error(`\n\x1b[31mFAIL:\x1b[0m ${e.stack || e.message || e}`);
    if (!KEEP && seeded.length) {
        console.error(`  (${seeded.length} seeded objects still exist; rerun with --only=cleanup to remove)`);
    }
    process.exit(1);
}

function seedRecords(structureId: string) {
    const first = captureOne(0, structureId);
    seeded.push(first);
    sleepSync(2000);
    for (let i = 1; i < N; i++) {
        seeded.push(captureOne(i, structureId));
        sleepSync(1200);
    }
    console.log(`  seeded ${seeded.length} records (runId=${runId})`);
}

function captureOne(i: number, structureId: string) {
    const text = `e2e-${runId}-${i}: sample capture at ${new Date().toISOString()}`;
    const { object, embedded, warning } = flows.capture(transport, { text, structureId });
    if (!embedded) throw new Error(`capture[${i}] embed failed: ${warning}`);
    return { id: object.id, text };
}

function verifyRetrieval(structureId: string) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
    const wide = flows.listInRange(transport, { structureId, from: oneHourAgo, to: now });
    const byId = new Map(wide.map(o => [o.id, o]));

    for (const s of seeded) {
        if (!byId.has(s.id)) throw new Error(`wide window (1h) missing seeded id ${s.id}`);
    }
    console.log(`  wide window (1h): all ${N} seeded records present ✓`);

    const oneSecAgo = now.getTime() - 1000;
    const narrow = wide.filter(o => {
        const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
        return t >= oneSecAgo;
    });
    if (narrow.some(o => o.id === seeded[0].id)) {
        throw new Error('narrow window unexpectedly includes the first (older) seed');
    }
    console.log(`  narrow window (1s): ${narrow.length} results, first-seed excluded ✓`);

    for (const s of seeded) {
        const o = byId.get(s.id);
        if (!o?.title || !o.title.startsWith(`e2e-${runId}-`)) {
            throw new Error(`seeded object ${o?.id} title malformed: ${o?.title}`);
        }
    }
}

function verifyDailyNote() {
    const notes = flows.getDailyNotes(transport, { marginDays: 1 });
    if (notes.length === 0) throw new Error('no daily notes found in the search window');
    const referenced = new Set<string>();
    for (const note of notes) {
        const blocksRecord = (note.blocks || {}) as Record<string, unknown>;
        for (const section of Object.values(blocksRecord)) {
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

function cleanupAll() {
    for (const s of seeded) {
        flows.deleteObject(transport, { id: s.id });
    }
    console.log(`  deleted ${seeded.length} objects ✓`);
}

function stage<T>(name: string, fn: () => T): T {
    process.stdout.write(`\x1b[36m→ ${name}\x1b[0m\n`);
    const t0 = Date.now();
    const out = fn();
    process.stdout.write(`  ${name} ok in ${Date.now() - t0}ms\n`);
    return out;
}

function doneOk(): never {
    console.log(`\n\x1b[32mPASS\x1b[0m runId=${runId}`);
    process.exit(0);
}

function fail(msg: string): never {
    console.error(`\x1b[31mFAIL:\x1b[0m ${msg}`);
    process.exit(1);
}

function parseArgs(argv: string[]) {
    const out: Record<string, any> = {};
    for (const a of argv) {
        if (a === '--keep') out.keep = true;
        else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    }
    return out;
}

function randomId(n: number) {
    return Math.random().toString(36).slice(2, 2 + n);
}

function sleepSync(ms: number) {
    execFileSync(
        process.execPath,
        ['-e', `setTimeout(()=>{}, ${ms}); setTimeout(()=>process.exit(0), ${ms})`],
        { stdio: 'ignore' },
    );
}
