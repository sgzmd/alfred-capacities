#!/usr/bin/env node
//
// scripts/e2e.ts — live smoke test against a real Capacities test space.
// Everything is synchronous — same shape as the JXA runtime.
//
//   node scripts/e2e.ts
//   node scripts/e2e.ts --keep          # skip cleanup
//   node scripts/e2e.ts --only=seed     # subset: bootstrap, seed
//   node scripts/e2e.ts --only=retrieve # subset: bootstrap, seed, retrieve

import { execFileSync } from 'node:child_process';

import * as flows from '../src/flows.ts';
import { makeNodeTransport } from '../src/transport/node.ts';
import { loadEnvToken } from './env.ts';

// Timing constants to ensure robust live execution without triggering rate limits
const SEED_RECORD_COUNT = 3;
const INITIAL_SEED_DELAY_MS = 2000;
const INTER_SEED_DELAY_MS = 1200;
const STAGE_COOLDOWN_MS = 2000;
const WIDE_WINDOW_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour
const NARROW_WINDOW_LOOKBACK_MS = 1000; // 1 second
const DAILY_NOTE_MARGIN_DAYS = 1;

const args = parseArgs(process.argv.slice(2));
const KEEP = args.keep === true;
const ONLY = args.only;

const token = loadEnvToken(import.meta.url);
if (!token) fail('CAPACITIES_TOKEN not set (use a dedicated test-space token or .env).');

const transport = makeNodeTransport({ token });
const runId = randomId(6);
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
    sleepSync(STAGE_COOLDOWN_MS);
    stage('retrieve', () => verifyRetrieval(bootstrap.structureId));

    if (ONLY === 'retrieve') doneOk();
    sleepSync(STAGE_COOLDOWN_MS);
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
    sleepSync(INITIAL_SEED_DELAY_MS);
    for (let i = 1; i < SEED_RECORD_COUNT; i++) {
        seeded.push(captureOne(i, structureId));
        sleepSync(INTER_SEED_DELAY_MS);
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
    const wideWindowStart = new Date(now.getTime() - WIDE_WINDOW_LOOKBACK_MS);
    const wide = flows.listInRange(transport, { structureId, from: wideWindowStart, to: now });
    const byId = new Map(wide.map(o => [o.id, o]));

    for (const s of seeded) {
        if (!byId.has(s.id)) throw new Error(`wide window (1h) missing seeded id ${s.id}`);
    }
    console.log(`  wide window (1h): all ${SEED_RECORD_COUNT} seeded records present ✓`);

    // Verify narrow window exclusion:
    // Only records created in the last NARROW_WINDOW_LOOKBACK_MS (1 second) before `now` are included.
    // Because seed[0] was created at least INITIAL_SEED_DELAY_MS (2s) ago, it must be excluded.
    const narrowCutoffMs = now.getTime() - NARROW_WINDOW_LOOKBACK_MS;
    const narrow = wide.filter(record => {
        const createdAtMs = record.createdAt ? new Date(record.createdAt).getTime() : 0;
        return createdAtMs >= narrowCutoffMs;
    });
    const firstSeededId = seeded[0].id;
    if (narrow.some(record => record.id === firstSeededId)) {
        throw new Error(`narrow window unexpectedly includes the older initial seed (${firstSeededId})`);
    }
    console.log(`  narrow window (1s): ${narrow.length} results, initial seed correctly excluded ✓`);

    for (const s of seeded) {
        const o = byId.get(s.id);
        if (!o?.title || !o.title.startsWith(`e2e-${runId}-`)) {
            throw new Error(`seeded object ${o?.id} title malformed: ${o?.title}`);
        }
    }
}

function verifyDailyNote() {
    const notes = flows.getDailyNotes(transport, { marginDays: DAILY_NOTE_MARGIN_DAYS });
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
