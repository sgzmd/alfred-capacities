// scripts/build.mjs — bundles TypeScript entry points into standalone JXA scripts.

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.resolve(root, 'dist');

if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
}

const entries = [
    { in: 'src/entries/capture.ts', out: 'send_to_daily_note' },
    { in: 'src/entries/setup.ts', out: 'setup' },
    { in: 'src/entries/log.ts', out: 'log' },
];

console.log('→ Building JXA bundles with esbuild...');

for (const entry of entries) {
    await esbuild.build({
        entryPoints: [path.resolve(root, entry.in)],
        outfile: path.resolve(dist, `${entry.out}.js`),
        bundle: true,
        platform: 'neutral',
        target: 'es2020',
        format: 'iife',
        banner: {
            js: '#!/usr/bin/env osascript -l JavaScript\n',
        },
        minify: false,
    });
    console.log(`  ✓ Built dist/${entry.out}.js`);
}

console.log('Build complete.');
