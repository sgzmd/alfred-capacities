# Capacities Quick Capture for Alfred

If you use [Capacities](https://capacities.io) for note‑taking and [Alfred](https://www.alfredapp.com) for driving your Mac, you have probably wondered why there isn't a dead‑simple, zero‑friction way to dump quick thoughts straight into your notes.

Well, now there is. Trigger Alfred, type, and get back to what you were doing.

## What's new in 2.0

- **Migrated to the Capacities v1 API.** The beta surface was retired on 2026‑09‑01; v1 uses **space‑scoped** tokens (one token per space, no more space picker) and a slightly different endpoint layout.
- **Captures are their own content type.** Every `cap <note>` writes a first‑class object of a user‑defined **DailyLog** content type (which you create once in the Capacities app) *and* embeds it in today's daily note. `cap:log 7` enumerates that content type over the last 7 days; ranges and ISO windows work too. No tag machinery — the object *is* a DailyLog.
- **The workflow is one small pipeline.** Ops · Transport · Flows — three seams, nothing else. Full unit test coverage plus a live smoke script.

## Installation

1. Download the latest release: [Capacities_Quick_Capture.alfredworkflow](Capacities_Quick_Capture.alfredworkflow).
2. Double‑click to import into Alfred.
3. In the Capacities desktop app, create a **content type** called `DailyLog` (Settings → Content types → New). This is where every capture will land — creating it once is a one‑time UI step because the API can't create content types itself.
4. In the workflow settings, paste a **space‑scoped** Capacities API token. Generate one in the Capacities desktop app under **Settings › Capacities API**. If you're upgrading from 1.x, you need a new token — the old ones granted all‑spaces access and no longer work.
5. Trigger Alfred and run **`cap:setup`** once. It verifies the token and finds the `DailyLog` content type by title (falls back to `Daily Log` / `Log` / `Note`); the resulting structure id is persisted to workflow config.

## Usage

### Capture

```
cap Wrote up requirements for CS operations
```

Creates a `DailyLog` object and embeds it in today's daily note. You'll see a "Note added successfully!" notification.

### Browse captures

```
cap:log            # last 7 days (default)
cap:log today
cap:log 3          # last 3 days
cap:log 30
cap:log 2026-09-01..2026-09-07
```

Alfred lists matching captures newest‑first; pressing Enter opens the object in Capacities.

## How it works

Three small pure files plus a swappable transport:

| File | What it holds |
|---|---|
| `ops.js` | one object per Capacities endpoint — `build(input)` and `parse(text)`. |
| `runner.js` | `run(op, input, transport)`, `parseRangeExpression`, `filterByDate`. |
| `flows.js` | named compositions: `capture`, `setup`, `listInRange`. |
| `transport/jxa.js` | `NSURLSession`‑backed HTTP for the Alfred runtime. |
| `transport/fetch.js` | Node `fetch`‑backed transport, used by `scripts/e2e.js`. |
| `transport/mock.js` | fixture transport, used by every unit test. |

The three JXA entry scripts (`send_to_daily_note.js`, `setup.js`, `log.js`) each read Alfred's input, build a `jxaTransport`, and call one flow. That's the whole shape.

## Development

```bash
# Unit tests (36 currently)
node --test 'test/*.test.js'

# Live smoke test against a real test space
CAPACITIES_TOKEN=<test-space token> node scripts/e2e.js

# Package the .alfredworkflow (also runs tests, and e2e if CAPACITIES_TOKEN is set)
./package.sh
```

`scripts/e2e.js` seeds ten records, retrieves them by tag with two different windows to check date filtering, verifies each was embedded in today's daily note, and deletes everything. Use `--keep` to skip cleanup.

## Automated releases

Merging to `main` with a bumped `version` in `info.plist` triggers the GitHub Actions release workflow: it packages the workflow, creates a Git tag, and publishes a GitHub release with the `.alfredworkflow` attached.
