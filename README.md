# Capacities Quick Capture for Alfred

A dependency-free Alfred workflow for capturing notes, Daily Logs, and browser
Weblinks in [Capacities](https://capacities.io).

The installed workflow runs entirely on software included with recent macOS
versions: JXA, Foundation, and curl. Node.js is needed only when developing or
packaging the workflow.

## Features

### Daily Note

Type `cap <note>` to append Markdown to today's Capacities Daily Note. The
existing Alfred Universal Action also sends selected text to the Daily Note.

### Daily Log

Type `today <entry>` to append the entry to today's Daily Note with
`#DailyLog`:

```markdown
<entry> #DailyLog
```

### Chrome Weblink capture

Type `cap:web` while Google Chrome has an active HTTP or HTTPS page.

The foreground action:

1. Copies only `[page title](https://page-url)` to the clipboard.
2. Immediately confirms that the link was copied.
3. Starts a background Capacities job.

The background job:

1. Searches Capacities Weblinks and verifies candidate URLs exactly after
   conservative normalization.
2. Reports when the Weblink already exists.
3. Otherwise creates a Weblink with the page title and the configured number of
   substantive introductory paragraphs as Markdown notes.
4. Shows a later success or failure notification.

Chrome must have **View > Developer > Allow JavaScript from Apple Events**
enabled so the workflow can extract paragraph text. Link capture still reports
a clear error if Chrome is closed, no tab exists, or the active URL is not HTTP
or HTTPS.

## Installation

1. Download `Capacities_Quick_Capture.alfredworkflow` from the latest GitHub
   release.
2. Double-click it to import the workflow into Alfred.
3. In the Capacities desktop app, open **Settings > Capacities API**.
4. Generate a personal token for the target space with read and write access.
5. Paste the `cap-api-…` token into the workflow configuration.

Capacities API v1 tokens are bound to one space, so a separate space selector
is neither needed nor supported.

## Configuration

| Setting | Default | Purpose |
| --- | ---: | --- |
| Capacities API Token | Required | Space-scoped `cap-api-…` token with read and write access |
| Weblink Paragraphs | `3` | Substantive paragraphs added to a newly created Weblink, from 0–20 |
| SOCKS5 Proxy | Empty | Optional `socks5://` or `socks5h://` URL |
| Connect Timeout | `10` | Connection timeout in seconds |
| Request Timeout | `45` | Total API request timeout in seconds |
| Retries | `2` | Retries for transient network, rate-limit, and server errors |

Prefer `socks5h://` when DNS resolution must also happen through the proxy.
Proxy credentials can be included in the proxy URL. Tokens and proxy
credentials are redacted from errors and are never placed directly in curl's
process arguments.

## Duplicate handling

The Weblink worker:

1. Searches `MediaWebResource` objects using the page URL and title.
2. Fetches each unique candidate.
3. Compares its URL with the captured URL after lowercasing the scheme and
   host, removing default ports and fragments, and preserving the path and
   query string.

A per-URL local lock prevents simultaneous captures on the same Mac from
creating duplicates. Capacities does not currently document a create
idempotency key, so truly simultaneous captures from different devices remain
an upstream limitation.

## Security and reliability

- Uses the Capacities API v1 endpoints and pins API version `0.1.0`.
- Uses SDK-exported TypeScript contracts during development without shipping
  the SDK runtime.
- Invokes curl using Foundation's `NSTask`, not interpolated shell commands.
- Stores request configuration, payloads, and asynchronous jobs in restricted
  temporary files and removes them after use.
- Retries only network errors, HTTP 429, 500, and 503 responses.
- Respects the Capacities `RateLimit` reset value when supplied.
- Keeps clipboard success independent from background API success.

## Development

Requirements:

- macOS
- Node.js 22 or later

Install dependencies:

```bash
npm ci
```

Trigger words are configured in the top-level `workflow.config.json`:

```json
{
  "keywords": {
    "dailyNote": "cap",
    "dailyLog": "today",
    "weblink": "cap:web"
  }
}
```

Each trigger must be a unique, non-whitespace Alfred keyword. The build validates
the configuration and injects it into the packaged `info.plist`.

Run strict type checking, build the JXA bundles, execute all tests, and enforce
100% core coverage:

```bash
npm run check
```

Create the importable workflow:

```bash
npm run package
```

Build output is written to `dist/`. The final archive contains only:

```text
info.plist
icon.png
daily-note.js
daily-log.js
capture.js
capacities-worker.js
```

No npm package or JavaScript runtime is required after the workflow is
installed.

## Release process

Pull requests run the macOS CI workflow, including type checking, 100% core
coverage, compiled JXA smoke tests, SOCKS5 transport smoke testing, plist
validation, and archive inspection.

After a version bump is merged into `main`, the release workflow builds and
tests the project, creates the `.alfredworkflow`, tags the version, and
publishes the archive as a GitHub release.
