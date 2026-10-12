// src/entries/mdlink.ts — entry point for `mdlink [n]` in Alfred.
// Bundles to dist/mdlink.js as a self-contained JXA script.

import { NodeHtmlMarkdown } from 'node-html-markdown';
import { initJxaBridge, readEnv, nsLog, copyToClipboard } from '../jxa-utils.ts';
import { makeJxaTransport } from '../transport/jxa.ts';
import { createWeblink, extractParagraphs, formatMarkdownLink } from '../flows.ts';

declare const Application: any;

export function run(argv: string[]): string {
    initJxaBridge();

    const token = readEnv('CAPACITIES_TOKEN');
    if (!token) return 'ERROR: CAPACITIES_TOKEN missing. Configure it in the workflow settings.';

    const nArg = (argv[0] || '').trim();
    const parsedN = nArg ? parseInt(nArg, 10) : 3;
    const paragraphCount = Number.isFinite(parsedN) && parsedN > 0 ? parsedN : 3;

    // Connect to Google Chrome
    let chrome: any;
    try {
        chrome = Application('Google Chrome');
        if (!chrome.running()) {
            return 'ERROR: Google Chrome is not running.';
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `ERROR: Cannot access Google Chrome: ${msg}`;
    }

    const windows = chrome.windows();
    if (!windows || windows.length === 0) {
        return 'ERROR: No open Google Chrome windows found.';
    }

    const activeTab = windows[0].activeTab();
    if (!activeTab) {
        return 'ERROR: No active Google Chrome tab found.';
    }

    const url = String(activeTab.url() || '').trim();
    if (!url) {
        return 'ERROR: Current Chrome tab has no URL.';
    }
    if (!/^https?:\/\//i.test(url)) {
        return `ERROR: Invalid tab URL: ${url}. Only http and https URLs can be captured as Weblinks.`;
    }
    const title = String(activeTab.title() || url).trim();

    // Grab DOM outerHTML
    let html = '';
    try {
        html = activeTab.execute({ javascript: 'document.documentElement.outerHTML' });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nsLog(`activeTab.execute failed: ${msg}`);
        return 'ERROR: Cannot read page DOM. In Chrome, please enable View > Developer > Allow JavaScript from Apple Events.';
    }

    // Convert DOM to Markdown
    let markdown = '';
    try {
        const nhm = new NodeHtmlMarkdown({
            ignore: ['script', 'style', 'head', 'noscript', 'nav', 'header', 'footer', 'svg', 'aside'],
        });
        markdown = nhm.translate(html || '');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nsLog(`HTML to Markdown conversion error: ${msg}`);
        markdown = '';
    }

    // Extract first n paragraphs
    const text = extractParagraphs(markdown, paragraphCount);

    // Create Weblink in Capacities
    const transport = makeJxaTransport({ token });
    try {
        createWeblink(transport, { url, title, text });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        nsLog(`createWeblink failed: ${msg}`);
        return `ERROR: ${msg}`;
    }

    // Copy Markdown link to clipboard
    const mdLink = formatMarkdownLink(title, url);
    copyToClipboard(mdLink);

    return `Weblink created & copied: ${mdLink}`;
}

// Ensure run is available globally to osascript
(typeof globalThis !== 'undefined' ? globalThis : this as any).run = run;
