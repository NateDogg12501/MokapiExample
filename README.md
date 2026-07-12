# Mokapi Weather Demo

A small demo showing how [mokapi](https://mokapi.io/) lets you substitute a
real third-party API — [weatherstack](https://docs.apilayer.com/weatherstack/docs/weatherstack-api-v-1-0-0) —
with a local, spec-driven mock, instead of hand-rolling your own fake API and
poking it with Postman.

The UI is a single weather lookup page with a source toggle:

- **Mokapi (local mock)** — requests go to a mokapi container running an
  OpenAPI spec for weatherstack's `/current` endpoint, with a JavaScript
  handler that returns whatever you've configured as a test scenario for the
  requested city.
- **Weatherstack (hosted)** — requests pass through to the real weatherstack
  API using your own access key.

The frontend and backend don't know or care which one is in play — both
paths return the same response shape, because mokapi is mocking the same
contract weatherstack defines.

## Architecture

```
                     ┌────────────────────┐
  Browser ────────▶  │  backend (Express)  │
  (localhost:3000)   │  serves frontend/    │
                     │  + /api/weather      │
                     │  + /api/scenarios    │
                     └─────────┬────────────┘
                        source=hosted │ source=mock
                                │      │
                 ┌──────────────┘      └──────────────┐
                 ▼                                     ▼
     api.weatherstack.com                  mokapi container
     (real API, needs a key)          (localhost:8090, from openapi.yaml
                                        + mock.js + scenarios.json)
```

The backend never exposes which source answered — it normalizes both into
the same `{status, ...}` shape before the frontend ever sees it. Scenario
saves from the UI write straight into `mokapi/scenarios.json`, which both
the backend (writer) and mokapi (reader) see via the same bind-mounted host
file, so there's no restart or polling involved.

## Why this matters

Instead of writing a throwaway fake API server and testing against it with
Postman, mokapi mocks *directly from the OpenAPI spec* and lets you script
scenario-specific behavior in plain JavaScript. That means:

- The mock's contract is the same spec you'd hand to consumers of the real API.
- Test scenarios are just data (`mokapi/scenarios.json`), not custom server code.
- Local/CI environments never depend on network access or a real API key.

## Prerequisites

- Docker Desktop (or another Docker Engine + Compose)
- A free [weatherstack](https://weatherstack.com/) access key — **only
  required if you want to try the "hosted" source**. The mock source works
  with no key at all.

## Adding your API key

```bash
cp .env.example .env
```

Edit `.env` and set:

```
WEATHERSTACK_ACCESS_KEY=your-key-here
```

`.env` is gitignored — the key is only ever passed into the backend
container as an environment variable, never baked into an image or committed.

## Running it

```bash
docker compose up --build
```

Then open:

- **App**: http://localhost:3000
- **Mokapi dashboard**: http://localhost:8080 — watch live mock requests/responses in real time
- **Mokapi mock API directly**: http://localhost:8090/current

## Using the UI

1. Enter a US city and pick a source, then **Get Weather**.
   - On success you'll see a success message, the city name, and the
     temperature in Fahrenheit — nothing else.
   - On error (mock only returns 400s; hosted may return other codes) you'll
     see the HTTP status, the upstream error code, and the error info message
     — nothing else.
2. Use **Manage Test Scenarios** to define what the mock returns for a given
   city:
   - Pick **Response Code** `200` or `400` (default `200`).
   - `200` scenarios ask for **City Name** and **Temperature**.
   - `400` scenarios ask for **Error Code** and **Error Info**.
   - Saving writes the scenario straight into `mokapi/scenarios.json` — mokapi
     picks it up on the very next request, no restart required.
   - A city with no scenario defined falls back to a generic 70°F success
     response, so the mock never hard-fails on an unrecognized city.
   - Saving shows a brief "Saved scenario for…" confirmation, and the table
     updates immediately with color-coded response-code badges.

The repo ships with one seeded scenario: `chicago` → 200, temperature 999°F.

## Demo script

A suggested walkthrough for showing this to developers/QA, in order:

1. **Look up "Chicago" with Mokapi selected.** You get "Success! City:
   Chicago, Temperature: 999°F" — an obviously fake number, which is the
   point: it proves the response came from the local mock, not a live
   weather service.
2. **Open the Mokapi Dashboard** (button top-right, or `localhost:8080`).
   Show the request you just made in the live log — this is the moment that
   makes the "we're not hand-rolling a fake server" pitch land: mokapi is a
   real service, generating real HTTP traffic, from a spec.
3. **Add a new scenario** in the UI for a city that doesn't exist yet:
   Response Code `400`, Error Code `615`, Error Info `Unable to geocode this
   location.`. Save it, then look that city up — you get the error rendering
   immediately, no restart.
4. **Open `mokapi/scenarios.json`** on disk and point out the scenario you
   just added is sitting there as plain JSON — nothing magic, no database.
5. **Toggle to Weatherstack (hosted)** and look up a real city (needs
   `WEATHERSTACK_ACCESS_KEY` set) to show the exact same UI, unmodified,
   working against the real API — same contract, same code path.
6. **Open `mokapi/openapi.yaml`** to close the loop: this one file is the
   entire contract driving the mock, and it's the same shape you'd hand a
   frontend team as documentation for the real API.

## Manual scenario editing

`mokapi/scenarios.json` is a plain JSON flat file, keyed by lowercased city
name:

```json
{
  "chicago": { "responseCode": 200, "cityName": "Chicago", "temperature": 999 },
  "miami": { "responseCode": 400, "errorCode": 615, "errorInfo": "Unable to geocode this location." }
}
```

You're welcome to hand-edit this file directly instead of using the UI —
mokapi re-reads it on every request, so changes are picked up immediately
with the containers still running.

## Known limitation: hosted error detection

The backend classifies a response as success/error purely by HTTP status
code (2xx vs. everything else), matching the stated acceptance criteria.
Some APIs in the apilayer family have, in the past, returned HTTP 200 with a
`success: false` body even for error cases. If weatherstack's hosted API
ever does that, the hosted path in this demo would misread it as a success.
The mock path is unaffected, since mokapi is explicitly told to return a
literal 200 or 400. If you hit this in practice, the fix is a small change
to `backend/src/normalize.js` to also check `body.success === false`.

## Troubleshooting

- **`GET http://localhost:8090/` returns 404.** Expected — mokapi's mock
  only defines `/current` (per `mokapi/openapi.yaml`), not a root route. The
  app itself is on `localhost:3000`; port 8090 is the raw mock API for
  `/current` requests only.
- **Mock lookups always return the generic 70°F fallback, even for a city
  you've defined a scenario for.** Check the mokapi container logs
  (`docker compose logs mokapi`). This previously happened here due to a
  script bug (see [CLAUDE.md](CLAUDE.md#gotchas-hit-during-initial-verification))
  — if `mock.js` has been edited since, that's the first place to look.
- **Hosted lookups fail immediately.** Confirm `.env` has
  `WEATHERSTACK_ACCESS_KEY` set and that `docker compose` picked it up
  (`docker compose config` will show the resolved value).
- **Port already in use.** 3000, 8080, or 8090 already bound locally? Change
  the host-side port in `docker-compose.yml` (left side of the `"host:container"`
  mapping) — no code changes needed.

## Working from multiple git worktrees

Each worktree is an independent checkout, so scenarios, bind mounts, and
Docker Compose's project name (derived from the directory name) are already
isolated per worktree — no code changes needed there. The one thing that
collides by default is host ports, since every worktree's `docker-compose.yml`
maps to the same `3000`/`8080`/`8090`.

To run more than one stack at once:

```bash
git worktree add ../MokapiExample-feature-x feature-x
cd ../MokapiExample-feature-x
cp .env.example .env   # then set WEATHERSTACK_ACCESS_KEY and, if running
                       # this alongside another worktree, override the ports:
                       #   BACKEND_PORT=3001
                       #   MOKAPI_DASHBOARD_PORT=8081
                       #   MOKAPI_API_PORT=8091
docker compose up --build
```

Each worktree needs its own `.env` (it's gitignored, so `git worktree add`
won't carry it over) and its own `npm install` inside `backend/` if you run
the backend outside Docker.

## Project layout

```
backend/    Express API + static frontend host
frontend/   Native HTML/CSS/JS UI, no build step
mokapi/     OpenAPI spec, JS scenario handler, scenarios.json
```

See [CLAUDE.md](CLAUDE.md) for the internal contract and file-by-file notes.
