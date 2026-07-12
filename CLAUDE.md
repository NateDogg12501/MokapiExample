# CLAUDE.md

Internal notes for working on this repo. See [README.md](README.md) for
user-facing setup/run instructions.

## What this is

A demo of using mokapi to mock the weatherstack "current weather" API,
toggleable against the real hosted API. Two runtime pieces behind one UI:

- `backend/` — Express app. Serves the static `frontend/` and proxies
  `/api/weather` to either the hosted weatherstack API or the local mokapi
  container, normalizing both into one response shape.
- `mokapi/` — OpenAPI spec + JS handler that mokapi runs to serve the mock.

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
- **A second mocked endpoint**: add a path to `mokapi/openapi.yaml` with its
  own `operationId`, then branch on `request.operationId` in `mock.js`
  (the handler already ignores operations it doesn't recognize).
- **Ports**: mokapi dashboard is 8080, mock API is 8090 (set via the
  `servers` entry in `openapi.yaml`), backend/UI is 3000. These are host-side
  mappings only, overridable per-checkout via `BACKEND_PORT`,
  `MOKAPI_DASHBOARD_PORT`, `MOKAPI_API_PORT` in `.env` (see
  `docker-compose.yml`) — this is what lets multiple git worktrees run their
  stacks concurrently. Container-internal traffic (e.g. backend reaching
  mokapi at `http://mokapi:8090/current`) uses the container port and is
  unaffected by these overrides.

## Working in a git worktree

**Run `node scripts/setup-worktree-env.js` automatically, without being
asked, whenever you set up a new worktree for this repo** (e.g. right after
`git worktree add`, before the first `docker compose up` in that worktree).
It creates `.env` from `.env.example` if missing and assigns that worktree a
non-colliding `BACKEND_PORT`/`MOKAPI_DASHBOARD_PORT`/`MOKAPI_API_PORT` based
on its position in `git worktree list`. Skipping this is the main way a
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
