# CLAUDE.md

Internal notes for working on this repo. See [README.md](README.md) for
user-facing setup/run instructions.

## What this is

A demo of using mokapi to mock two different protocols, each toggleable
against the real thing, behind one UI with a top-level tab switch:

- **REST API tab** — the weatherstack "current weather" API, mocked via an
  OpenAPI spec, vs. the real hosted API.
- **Email tab** — SMTP email, mocked via mokapi's mail spec, vs. real Gmail
  SMTP.

Runtime pieces:

- `backend/` — Express app. Serves the static `frontend/` and proxies
  `/api/weather` to either the hosted weatherstack API or the local mokapi
  container (normalizing both into one response shape), and `/api/email/*`
  to either Gmail SMTP or mokapi's mock SMTP server.
- `mokapi/` — OpenAPI spec + JS handler for the weather mock (`openapi.yaml`,
  `mock.js`), plus a mail spec for the email mock (`mail.yaml`). Both files
  live in the same provider directory and mokapi auto-discovers and runs
  both mocks (HTTP + SMTP) from one container.

## The normalization contract

`backend/src/normalize.js` turns *either* upstream's response into:

```js
// success
{ status: 'success', city, temperatureF }
// error
{ status: 'error', httpStatusCode, errorCode, errorInfo }
```

Classification is HTTP-status-only (2xx = success). This is intentional —
see the "Known limitation" section in the README before changing it.

The frontend (`frontend/app.js`) renders purely off `data.status` and never
sees weatherstack's raw response shape. If you add a new field to display,
add it here first, then in `app.js`'s `renderLookupResult`.

## Mokapi scripting facts (verified against mokapi's docs and a live v0.49.0 container)

- Scripts are ES modules exporting a default function that calls
  `on('http', (request, response) => {...})` from the `mokapi` module.
- `request.query.<name>` / `request.operationId` come from the OpenAPI spec —
  a query param or operationId not declared in `openapi.yaml` won't show up.
- `response.data` sets a structured body validated against the OpenAPI
  schema for the *currently selected* response definition.
- `response.rebuild(statusCode)` is required before setting `response.data`
  when you want to switch which response definition (200 vs 400 here) is
  used — otherwise the schema/status from the first-declared response wins.
- `read('./scenarios.json')` reads a file relative to the script, fresh on
  every call — this is what makes scenario edits show up without restarting
  the mokapi container. **It must be imported from `mokapi/file`, not
  `mokapi`** — `import { read } from 'mokapi/file'`. Importing it from
  `mokapi` doesn't error at load time; it fails at call time with
  `Value is not an object: undefined`, which silently sends every request
  down the "no scenario found" fallback path. This cost real debugging time
  once — see "Gotchas" below.

## Mokapi mail mocking facts

Sourced from mokapi's own `examples/mail` config and the official
`marle3003/mokapi-email-workflow` demo repo — **not** exercised against a
live container in this sandbox; see "Gotchas" below for why, and verify
end-to-end the first time you touch this.

- `mokapi/mail.yaml` uses the `mail: '1.0'` root (not the older `smtp: '1.0'`
  format some mokapi docs still show under a "Legacy" heading). It declares
  an SMTP server under `servers.<any-name>.host` + `.protocol: smtp` — the
  server key name (`smtp` here) is just a label, not a fixed keyword.
- `host: :2525` binds all interfaces inside the container. This matters
  because the backend container reaches it as `mokapi:2525`, not
  `localhost:2525` — `host: localhost:2525` (as mokapi's own docs example
  shows for local-only use) would NOT be reachable cross-container.
- No `mailboxes`/`rules` are defined, so mokapi accepts mail to any
  recipient address — matches the free-text "To" field in the Email tab. Add
  `mailboxes:` + a `rules:` block only if you need to restrict/simulate auth.
- Mokapi's mail REST API (served on the same dashboard port, 8080) is
  namespaced by the mail spec's `info.title`, not its filename:
  - `GET /api/services/mail/{titleUrlEncoded}/mailboxes/{recipient}/messages?limit=1`
    → array of message summaries (`subject`, `from[].address`, `to[].address`,
    `messageId`).
  - `GET /api/services/mail/messages/{messageId}` → `{ data: { body, ... } }`
    — full message, note the response is wrapped in `data`.
  - `backend/src/emailClient.js`'s `MOKAPI_MAIL_SERVICE_TITLE` env var
    **must match** `mokapi/mail.yaml`'s `info.title` exactly (`Mokapi Email
    Demo`) or every inbox lookup 404s silently into an "empty" result. If you
    rename one, rename the other.
- Sending mail: any real SMTP client works against the mock — nodemailer
  pointed at `host: 'mokapi', port: 2525, secure: false, tls: {
  rejectUnauthorized: false }` is what `backend/src/emailClient.js` uses.
  There's also a mokapi-native JS scripting API (`import { send } from
  'mokapi/smtp'`) for sending mail *from* a mokapi script, but that's not
  needed here since the backend is the one sending, not mokapi.

## Scenario data flow

1. UI form (`frontend/index.html` + `app.js`) → `PUT /api/scenarios/:city`.
2. `backend/src/scenarioStore.js` validates the payload (200 needs
   `cityName`+`temperature`; 400 needs `errorCode`+`errorInfo`) and writes
   the whole scenarios map to `SCENARIOS_FILE_PATH`.
3. That path is a bind mount (`./mokapi:/mokapi-data` on the backend
   container) pointing at the *same host file* mokapi's own container reads
   via `./mokapi:/mokapi` + `read('./scenarios.json')` in `mock.js`. No
   restart, no polling — both containers see the same file on disk.

Scenario keys are always the lowercased, trimmed city string, so lookups
from the UI (`query` param) and scenario keys line up without a fuzzy-match
step.

## Extending this

- **New scenario field** (e.g. a `humidity` value): add it to the form in
  `index.html`, to `validateScenario` in `scenarioStore.js`, and to the
  `response.data` construction in `mokapi/mock.js`.
- **A second mocked HTTP endpoint**: add a path to `mokapi/openapi.yaml` with
  its own `operationId`, then branch on `request.operationId` in `mock.js`
  (the handler already ignores operations it doesn't recognize).
- **A third tab/module**: add a `.tab-button`/`.page` pair in `index.html`
  (follow the `data-page` / `id="page-*"` pattern), wire it into
  `pageSections` in `app.js`'s tab-navigation block, and give it its own
  card(s) — the tab-switching JS is generic over however many pages exist in
  `pageSections`.
- **Ports**: mokapi dashboard/mail-API is 8080, mock weather API is 8090
  (set via the `servers` entry in `openapi.yaml`), mock SMTP is 2525 (set in
  `mail.yaml`), backend/UI is 3000. These are host-side mappings only,
  overridable per-checkout via `BACKEND_PORT`, `MOKAPI_DASHBOARD_PORT`,
  `MOKAPI_API_PORT`, `MOKAPI_SMTP_PORT` in `.env` (see `docker-compose.yml`)
  — this is what lets multiple git worktrees run their stacks concurrently.
  Container-internal traffic (e.g. backend reaching mokapi at
  `http://mokapi:8090/current` or `mokapi:2525` for SMTP) uses the container
  port and is unaffected by these overrides.

## Working in a git worktree

**Run `node scripts/setup-worktree-env.js` automatically, without being
asked, whenever you set up a new worktree for this repo** (e.g. right after
`git worktree add`, before the first `docker compose up` in that worktree).
It creates `.env` from `.env.example` if missing and assigns that worktree a
non-colliding `BACKEND_PORT`/`MOKAPI_DASHBOARD_PORT`/`MOKAPI_API_PORT`/
`MOKAPI_SMTP_PORT` based on its position in `git worktree list`. Skipping this is the main way a
second worktree's `docker compose up` fails with "port is already
allocated" against a stack still running in another worktree (including the
primary checkout). The script is idempotent — safe to re-run, and a no-op
(default ports) in the primary checkout.

## Gotchas hit during initial verification

Two bugs made it past manual code review and only showed up once this ran in
an actual Docker Desktop environment (the sandbox this repo was first built
in had no Docker/Node available, so the first pass was reviewed but not
executed). Both are fixed now, but the root causes are worth knowing if
something similar resurfaces after a refactor:

1. **Static file serving pointed at the wrong path.** `server.js` computed
   the frontend path as `path.join(__dirname, '..', 'frontend')`, i.e.
   `/frontend` inside the container. But `docker-compose.yml` bind-mounts
   the frontend at `./frontend:/app/frontend`, i.e. `/app/frontend`. Since
   `__dirname` is `/app`, the fix is `path.join(__dirname, 'frontend')`. If
   you change the WORKDIR in `backend/Dockerfile` or the mount path in
   compose, these two need to move together.
2. **`read()` imported from the wrong module** — see the mokapi scripting
   note above. The failure mode is silent (every mock lookup falls back to
   the generic 70°F response, no error surfaced to the caller), which is
   why it's worth testing at least one *seeded* scenario (`chicago` → 999°F)
   after any change to `mock.js`, not just the fallback path.

Also worth knowing: hitting `http://localhost:8090/` (no path) returns a
404 from mokapi. That's correct — the OpenAPI spec only declares `/current`.
It's not a sign anything is broken; the actual app is on port 3000.

The Email tab's mokapi mail mocking (`mokapi/mail.yaml`,
`backend/src/emailClient.js`) was built the same way as the original REST
demo before it was ever run in Docker: reviewed against mokapi's *own*
official example config and demo repo (not hallucinated), but not yet
exercised against a live container in this sandbox (no Docker/Node here
either). The two likely failure points if something's off after the first
real run, by analogy with the gotchas above:
- **Service title mismatch** between `mail.yaml`'s `info.title` and
  `MOKAPI_MAIL_SERVICE_TITLE` in `docker-compose.yml` — silent failure mode
  is every inbox check coming back `{status: 'empty'}` even after a
  successful send, since the REST lookup URL just 404s.
- **SMTP host/port wrong for the container network** — `emailClient.js`
  talks to `mokapi:2525`; if that ever gets changed to `localhost:2525` it
  will fail from inside the backend container (see the mail-mocking facts
  section above on why `host: :2525`, not `host: localhost:2525`, matters
  in `mail.yaml`).

## Things intentionally left simple

- No auth/validation of `access_key` in the mock — the mock exists to test
  application logic against realistic response shapes, not to simulate
  weatherstack's auth failures.
- No temperature unit conversion — everything requests `units=f` from
  weatherstack directly, and scenario temperatures are entered as
  already-Fahrenheit values.
- No database — scenarios are a flat JSON file by design (see the project's
  original requirements: this needed to be something a reader can open and
  understand in one glance).
- No subject-line field in the Email tab — every send uses a fixed subject
  (`"Message from Mokapi Email Demo"`). The point of the tab is contrasting
  a mocked vs. real SMTP destination for a given body, not building a full
  mail composer.
- No mailbox auth in `mail.yaml` — anyone (any recipient address) can
  receive mail in the mock, matching the free-text "To" field. Real Gmail
  SMTP still requires `GMAIL_USER`/`GMAIL_APP_PASSWORD` since that's a real
  external service.
