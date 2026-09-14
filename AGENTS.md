# AGENTS.md

Reference for anyone — human or LLM — coming into this repo. Reads top‑to‑bottom in ~5 min. If you're about to change anything non‑trivial, skim it first: several parts of the code look wrong until you know why they aren't.

## What this project is

Alfred workflow (JXA) plus a small Node dev harness that lets you `cap <note>` and get a first‑class, retrievable capture in Capacities. Everything talks to the **Capacities v1 API** (`https://api.capacities.io`, `Capacities-API-Version: 2026-01-01` header). The old beta surface was retired on 2026‑09‑01; nothing in the repo touches it.

Three user‑visible entry points, all served by the same pipeline:

- `cap <note>` → create an object of the user's **DailyLog content type** (a user‑defined structure), embed it in today's daily note.
- `cap:setup` → discover the space, find a content type titled `DailyLog` (or `Daily Log` / `Log` / `Note`), persist its structure id into workflow config. **The user has to create the content type in the Capacities app first** — the API can't create structures.
- `cap:log [range]` → list every DailyLog object in a date range (`today`, `week`, `N`, `YYYY-MM-DD..YYYY-MM-DD`). Enumerates by structure id, filters by `createdAt` client-side.

There is no "DailyLog tag" — the object's structure is the retrieval key. Every capture *is* a DailyLog, not a page‑with‑a‑tag.

## Architecture

Three seams. Every file falls into exactly one.

```
                      ┌────────────────────────────┐
   Alfred / Node CLI ─┤ entry script (~10 lines)   │
                      └────────────┬───────────────┘
                                   │ calls one flow
                                   ▼
                      ┌────────────────────────────┐
                      │ flows.js  (capture, setup, │
                      │            listInRange, …) │
                      └────────────┬───────────────┘
                                   │ run(op, input, transport)
                        ┌──────────┴──────────┐
                        ▼                     ▼
              ┌───────────────────┐  ┌───────────────────┐
              │ ops.js            │  │ transport/*.js    │
              │  one obj per API  │  │  jxa | node | mock│
              │  endpoint         │  │                   │
              └───────────────────┘  └───────────────────┘
```

- **op** = `{ name, build(input) → {method, path, body?, query?}, parse(text) → any }`. Pure, no I/O. One object per endpoint. Add a new endpoint = add one object.
- **transport** = a single function `{method, path, body?, query?} → {status, text}`. **Synchronous**. Three interchangeable implementations. Never touched directly by ops or flows.
- **flow** = a named composition of `run(op, input, transport)` calls. Business logic. Pure.

Adding features, testing, and swapping HTTP all touch exactly one of the three seams.

### Everything is synchronous. Do not add `async`/`await` anywhere.

JXA's JavaScriptCore doesn't drain microtasks between runloop yields, so `async` functions never resolve under `osascript` — the program hangs forever. This is why:

- `run()` in `runner.js` is a plain function, not `async`.
- Every op's `build`/`parse` is sync.
- Every flow returns a plain value.
- The Node transport uses `execFileSync('curl', …)` (sync).
- The JXA transport blocks on `NSTask.waitUntilExit`.

If you catch yourself typing `async`, stop. You'll break the JXA runtime and every test will still pass, so the failure won't show up until someone runs Alfred.

## File layout

```
runner.js               run(op, input, transport), ApiError,
                        parseRangeExpression, filterByDate
ops.js                  one plain object per API endpoint
flows.js                capture, setup, listInRange,
                        getDailyNote / getDailyNotes, deleteObject,
                        findLogStructure, readProperty,
                        DEFAULT_LOG_TITLES
transport/jxa.js        JXA transport: NSTask + /usr/bin/curl
transport/node.js       Node transport: execFileSync('curl', …)
transport/mock.js       fixture-driven transport for tests

jxa-bootstrap.js        loadModule(), readEnv(), scriptDir(), saveConfig()
send_to_daily_note.js   `cap <note>` — capture flow
setup.js                `cap:setup` — bootstrap flow
log.js                  `cap:log <range>` — Alfred script filter

scripts/e2e.js          live smoke test against a real space
scripts/dev.js          maintenance CLI: list / clean / delete / get / …

test/ops.test.js        every op's build/parse
test/transport.test.js  makeNodeTransport headers/body/query + mock
test/flows.test.js      capture/setup/listInRange via mockTransport
test/range.test.js      parseRangeExpression + filterByDate

info.plist              Alfred workflow — 3 keywords, 3 config vars
package.sh              node --test + optional e2e + zip
.github/workflows/      test.yml (push/PR) + release.yml (main → tag)
```

## The three flows

### `capture(transport, { text, structureId })`

Two ops, both required for a full capture; only the first is critical.

1. `POST /object/markdown` with `structureId` and a markdown string of the form `# <title>\n\n<body>`.
   - Title = `splitTitleAndBody(text).title`. Two‑branch rule: raw first line if it fits in TITLE_MAX (60 chars) and is single‑line, otherwise strip markdown syntax from the first line and use that (up to a generous 200‑char cap, then word‑boundary trim). The stripping only kicks in when truncation would happen — short markdown‑bearing lines keep their raw form. Filenames like `ESA_Data_Export_Q3.xlsx` survive stripping because underscore‑italic only matches at word edges.
   - Body = full original input (verbatim). The API strips the first H1 and stores it as `properties.title`, so the H1 does not visibly duplicate the body.
   - We can't use `POST /object` with `properties.title` because it silently drops the markdown body (verified live: the body comes back as an empty `TextBlock`). And we can't use `/object/markdown` with `properties.title` because it drops `properties`. Both endpoints have complementary silent drops — the H1 prefix is the only shape that gets title *and* body honoured.
   - No `tags` — the object's structureId is the retrieval key.
   - Returns `{ object, embedded: true }`.
2. `POST /blocks/daily-note/append` with `blocks: [{ type: 'EntityBlock', entityId }]`.
   - `entityId` is a top‑level string. `entity: { id }` gets a 400.
   - The API queues, then delivers into the daily note **in the account's local timezone**. A capture at 22:59 UTC on day N can land on day N+1's daily note.
   - If this fails, the object still exists and is still enumerable via `/objects/structure`. Flow returns `{ object, embedded: false, warning: … }` instead of throwing — the entry script surfaces a soft warning notification.

### `setup(transport, { forceStructureId? })`

Idempotent bootstrap. **Find, don't create** — the API can't POST structures.

1. `GET /space` — verify token, capture space title.
2. `GET /space/structures` — enumerate structures.
3. `findLogStructure(list, DEFAULT_LOG_TITLES)` — case‑insensitive title match against `["DailyLog", "Daily Log", "Log", "Note"]`, in that order, skipping every built‑in `Root*` type.
4. If no match → throw with instructions naming every structure in the space and telling the user to add a content type in the Capacities app (Settings → Content types → New).

Returns `{ space, structureId, structureTitle }`. Callers persist these into config.

`forceStructureId` bypasses discovery. If it names a listed structure, use that. If it's a built‑in `Root*` (e.g. `RootPage`), trust the caller — those work even when not advertised in `/space/structures`. Used by `scripts/e2e.js` (defaults to `RootPage`, the one built‑in that carries a `createdAt` property so the range filter can be exercised without asking the tester to create a content type first).

### `listInRange(transport, { structureId, from, to })`

Two‑step because the list response is abridged.

1. `GET /objects/structure?id=<structureId>` returns rows with **only** `{id, title, structureId}` — no `createdAt`, no other properties.
2. For each row, `GET /object?id=<id>` to fetch the full object (paced by the transport to stay under Cloudflare's per‑IP threshold).
3. `readProperty(o, 'createdAt' | 'title')` unwraps the `{type, <type>: { value }}` envelope Capacities uses for every property.
4. `filterByDate(hydrated, {from, to})` — inclusive from, exclusive to, sorts newest first.

Only structures with a `createdAt` property give meaningful range results. `RootPage` and typical user content types do; `RootTask` doesn't (probed live — its properties are `date`, `deadline`, `status`, `priority`, `completed` but no `createdAt`). If you're setting up your own `DailyLog` content type, make sure it inherits `createdAt` — it's on by default.

Range grammar (`parseRangeExpression`): `""` / `"week"` = last 7d, `"today"` = midnight UTC to now, `"N"` = last N days (max 3650), `"YYYY-MM-DD..YYYY-MM-DD"` = inclusive on both ends. Any other input throws.

### `getDailyNotes(transport, { date?, marginDays? })`

Search‑based, because `GET /blocks/daily-note` doesn't exist. Iterates over `[date - marginDays, date + marginDays]`, searches `structureIds: ['RootDailyNote']` with each ISO day as the query, dedupes and hydrates every hit. Default `marginDays = 1` covers the "the append landed on the neighbouring UTC day" edge case above.

`getDailyNote(...)` is a back‑compat wrapper returning the first result.

## Capacities v1 API quirks worth remembering

Every one of these was found by live probing (see `git log` for the evolution). Do not "fix" the code back toward what the docs might imply — the docs are wrong or incomplete on each of these points.

- **Tokens are space‑scoped.** No `spaceId` in any request body. One token = one space.
- **The API can't create structures.** `POST /structure`, `/structures`, `/space/structures` all 404. Content types have to be added in the Capacities app. `cap:setup` finds an existing one; it doesn't try to create.
- **`POST /object/markdown` silently drops `properties`.** It pulls the title from the first `# H1` in the markdown instead.
- **`POST /object` silently drops `markdown`.** It creates the object with a single empty `TextBlock` as the body regardless. Verified live in both directions.
- **Result**: to set both title and body, you have to use `/object/markdown` with `# <title>\n\n<body>`. The H1 gets consumed as the title (does not appear in the rendered body).
- **`RootPage` works even when not listed in `GET /space/structures`.** Bare spaces that only advertise `RootTag`/`RootTask`/`RootDailyNote` still accept `POST /object` with `structureId: RootPage`. e2e leans on this so it can smoke‑test without asking the tester to define a content type first.
- **`RootDailyNote` is not user‑creatable.** `POST /object` with it returns "This object type cannot be created via this endpoint."
- **`RootTask` has no `createdAt` property.** Different built‑in structures expose different property sets. If you point `listInRange` at a structure without `createdAt`, everything filters out as malformed. `RootPage` and typical user content types do have it — if you build your own DailyLog content type, keep `createdAt` on it (default).
- **Title from `properties.title` is silently ignored on `/object/markdown`.** On `POST /object` it works.
- **`GET /objects/tag` and `GET /objects/structure` both use `?id=`** (the tag / structure id), not `?tag=` / `?structureId=`. The other names 400 with "expected string at id". Results come back under `results`, not `objects`.
- **List responses (`/objects/structure`, `/objects/tag`, `/objects/search`) are abridged.** Only `{id, title, structureId}`; no `createdAt` or other properties. Hydrate per id via `GET /object?id=…` when you need more.
- **`GET /object?id=<uuid>`.** Path‑param form (`/object/<id>`) 404s.
- **`DELETE /object?id=<uuid>`.** Same shape.
- **No `GET /blocks/daily-note` endpoint.** The daily note is an object; search `RootDailyNote` for a title matching `YYYY-MM-DDT00:00:00.000Z` and fetch that object. Its `blocks.RootDailyNote_notes` array is what you want.
- **Daily‑note append uses account‑local time, not UTC.** A capture at 22:59 UTC on day N can land on day N+1's daily note (verified: KST‑aligned accounts see this every night). `getDailyNotes` in `flows.js` widens the search to ±1 day to compensate.
- **Property envelope.** Every property looks like `{"type":"title","title":{"value":"…"}}` or `{"type":"entity","entity":[{"id":"…"}]}`. `readProperty(obj, name)` in `flows.js` unwraps this — use it.
- **`POST /objects/search` requires `query` ≥ 1 character.** Passing `""` 400s.
- **Cloudflare rate‑limits at error code 1015** after roughly 10 requests in a burst, per IP. Blocks persist for **tens of seconds up to a minute or two** — longer than in‑request retry can bridge alone. Both transports pace at 200 ms min interval and retry 429/503 with exponential backoff up to 15 s, and e2e still keeps `N` small (3) with an extra 600 ms between captures. Do not remove either layer.
- **EntityBlock daily‑note timestamps are automatic.** Capacities inserts its own `TextBlock` with the current wall‑clock time before every `EntityBlock` you append — you get the "15:47 → entry" look for free. Do not add a hand‑formatted `HH:MM · text · #DailyLog` line.

## JXA quirks worth remembering

Every one of these was found by test.

- **`async`/`await` does not work.** Microtasks don't drain across `runUntilDate` yields. Whole program hangs. Everything must be sync.
- **`NSURLSession` completion‑handler blocks don't survive the JXA bridge.** The task object comes back without a callable `resume`. This is why `transport/jxa.js` uses `NSTask` + curl instead.
- **`NSURLConnection.sendSynchronousRequestReturningResponseError` Ref() out‑params are unreliable.** `Ref()[0]` came back nil even for successful requests. Do not try to resurrect it.
- **`ObjC.import('Foundation')` is not enough for URL classes.** You also need `ObjC.import('Cocoa')` for `NSMutableURLRequest` / `NSURLSession` on macOS 15+. `jxa-bootstrap.js` imports both.
- **`osascript` script path lookup.** `NSProcessInfo.processInfo.arguments` contains the script path — `jxa-bootstrap.scriptDir()` walks it. Each entry script has an inline `scriptDirFallback()` for the moment before bootstrap loads.
- **Fish shell env vars.** `CAPACITIES_TOKEN=… node …` doesn't work in fish; use `env CAPACITIES_TOKEN=… node …` or `set -x CAPACITIES_TOKEN …; node …`. bash/zsh are fine.
- **JXA's `$.dispatch_semaphore_*` symbols are flaky.** We used to spin a semaphore around `dataTaskWithRequestCompletionHandler`; it hung. `$.NSThread.sleepForTimeInterval(sec)` works reliably for the retry backoff.
- **`plutil` is your friend.** `plutil -lint info.plist` catches broken XML instantly; a broken plist makes Alfred silently refuse to import the workflow.

## Running things

All commands assume repo root as cwd. `CAPACITIES_TOKEN` must be a space‑scoped v1 token from Capacities → Settings → Capacities API.

```bash
# 41 unit tests, no network.
node --test 'test/*.test.js'

# Live smoke test. Bootstrap → seed 3 records → retrieve → verify daily-note
# embeds → cleanup. --keep skips cleanup. Takes ~12 s green.
CAPACITIES_TOKEN=… node scripts/e2e.js

# Maintenance CLI. Same transport/ops/flows as the workflow, so drift is
# impossible.
CAPACITIES_TOKEN=… node scripts/dev.js help
CAPACITIES_TOKEN=… node scripts/dev.js list                     # every DailyLog capture
CAPACITIES_TOKEN=… node scripts/dev.js list --prefix=e2e-       # filter by title
CAPACITIES_TOKEN=… node scripts/dev.js clean --prefix=e2e-      # delete e2e leftovers
CAPACITIES_TOKEN=… node scripts/dev.js clean --dry-run          # preview
CAPACITIES_TOKEN=… node scripts/dev.js delete <id> [<id>...]
CAPACITIES_TOKEN=… node scripts/dev.js get <id>
CAPACITIES_TOKEN=… node scripts/dev.js structures
CAPACITIES_TOKEN=… node scripts/dev.js curl GET /space

# Package the .alfredworkflow. Runs unit tests; runs e2e if CAPACITIES_TOKEN
# is set and SKIP_E2E is not 1.
./package.sh
SKIP_E2E=1 ./package.sh

# Run a JXA entry script from the shell (Alfred substitute for debugging).
# For a real workspace, use the id of your DailyLog content type; for the
# bare test space, RootPage works.
env CAPACITIES_TOKEN=… CAPACITIES_LOG_STRUCTURE_ID=RootPage \
    osascript -l JavaScript send_to_daily_note.js 'test capture'
```

CI (`.github/workflows/test.yml`) runs unit tests on every push and PR. The release workflow (`release.yml`) fires on merges to `main` with a bumped `info.plist:version`, tags `vX.Y.Z`, and publishes the `.alfredworkflow`.

## Adding a new API endpoint

Do all four steps or nothing works end‑to‑end.

1. **Add an op** in `ops.js`. Two‑method contract, exports name in the `ops` map at the bottom.
2. **Use it in a flow** in `flows.js`. Import from the same `ops` object; call via `run(MyOp, input, transport)`.
3. **Test the op** in `test/ops.test.js` — assert URL, method, body shape, and the parse behaviour on success and empty‑body cases.
4. **Test the flow** in `test/flows.test.js` with `makeMockTransport` fixtures keyed `'METHOD path'`.

The transport layer doesn't need touching. Neither does any JXA entry script — flows are what Alfred calls, not ops.

## Debugging

- `$.NSLog(...)` from JXA lands in `Console.app` under `osascript`. `send_to_daily_note.js` already logs the raw ApiError on failure.
- `scripts/dev.js curl METHOD /path [body-json]` fires a request through the same transport (with pacing and retry) as everything else. Faster than `curl` in a loop for shape probing.
- `scripts/dev.js get <id>` prints the full object JSON. Use it to confirm property envelopes.
- On rate‑limit (429 with `error code: 1015`), wait ~60–90 s before retrying anything against the live API.

## What NOT to do

- Don't add `async`/`await`. See above.
- Don't push the token into ops. The transport owns auth.
- Don't reintroduce a "DailyLog tag" or a `tags` property on captures. The structure id *is* the retrieval key; adding a redundant tag just doubles the ways things can drift.
- Don't hand‑format daily‑note lines (`"- HH:MM — text #DailyLog"`). Use `EntityBlock`; the API supplies the timestamp automatically.
- Don't drop the `# <title>` H1 prefix on the capture body. Without it, `/object/markdown` leaves the title empty. Don't switch to `POST /object` for captures either — that endpoint drops the body.
- Don't assume the daily note the API appended to has today‑UTC's date. Search across ±1 day.
- Don't remove the transport's pacing or retry layer. Cloudflare is quicker to block than to unblock.
- Don't drop the `Bash(CAPACITIES_TOKEN=* node *)` / `osascript` allowlist entries in `.claude/settings.local.json`. They exist because the tool prompts once per command shape otherwise.
- Don't commit a real `CAPACITIES_TOKEN`. Tokens are space‑scoped and revocable in the Capacities app; still, treat them as secrets.

## Provenance

Everything in this doc is empirically verified against a live v1 space (`space id b0aa6569-…`, September 2026). If any point above contradicts what you observe now, the API changed — probe with `scripts/dev.js curl`, update the code, and update this file.
