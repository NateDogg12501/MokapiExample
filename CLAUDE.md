# CLAUDE.md

Internal notes for working on this repo. See [README.md](README.md) for
user-facing setup/run instructions.

## What this is

A demo of using local mocks — mokapi for two protocols, localstack for two
more — each toggleable against the real thing, behind one UI with a
top-level tab switch:

- **REST API tab** — the weatherstack "current weather" API, mocked via an
  OpenAPI spec, vs. the real hosted API.
- **Email tab** — SMTP email, mocked via mokapi's mail spec, vs. real Gmail
  SMTP.
- **AWS tab** — an SQS queue, mocked via a localstack container, vs. a real
  hosted SQS queue.
- **Snowflake tab** — CRUD on a `person` table, mocked via a LocalStack for
  Snowflake container, vs. a real Snowflake warehouse.

Runtime pieces:

- `backend/` — Express app. Serves the static `frontend/` and proxies
  `/api/weather` to either the hosted weatherstack API or the local mokapi
  container (normalizing both into one response shape), `/api/email/*` to
  either Gmail SMTP or mokapi's mock SMTP server, `/api/aws/*` to either
  real AWS SQS or a local `localstack` container's mock SQS, and
  `/api/snowflake/*` to either a real Snowflake warehouse or a local
  `localstack-snowflake` container's mock.
- `mokapi/` — OpenAPI spec + JS handler for the weather mock (`openapi.yaml`,
  `mock.js`), plus a mail spec for the email mock (`mail.yaml`). Both files
  live in the same provider directory and mokapi auto-discovers and runs
  both mocks (HTTP + SMTP) from one container.
- `localstack` (docker-compose service, no config files of its own) — mocks
  AWS SQS. Unlike mokapi's spec-file-driven discovery, its queue is created
  by a one-shot `localstack-init` service in `docker-compose.yml` (an
  `amazon/aws-cli` container that runs `sqs create-queue` once and exits),
  not by application code — `backend/src/sqsClient.js` only ever resolves
  an already-existing queue, symmetric with how it treats a real AWS queue.
  Requires `LOCALSTACK_AUTH_TOKEN` (free signup) to start at all — see
  "Gotchas" below.
- `localstack-snowflake` (docker-compose service, image
  `localstack/snowflake`) — mocks a Snowflake warehouse. Its database/table
  are created by a one-shot `snowflake-mock-init` service (`snowflake-init/`,
  a small Node container using `snowflake-sdk` directly — see "Snowflake
  mocking facts" below), the same infra-not-application-code pattern as
  `localstack-init`. Requires its own paid-tier `LOCALSTACK_AUTH_TOKEN`
  entitlement — see "Snowflake mocking facts" below, this is *not* covered
  by the free token the SQS `localstack` service uses.

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

## AWS SQS mocking facts (localstack)

Queue provisioning is deliberately kept out of `backend/src/sqsClient.js`
(the integration layer) — a one-shot `localstack-init` service in
`docker-compose.yml` creates the localstack queue, the same way a real
deployment's infra/setup process would create the real one. The backend's
job is identical for both sources: resolve an already-existing queue via
`GetQueueUrlCommand` (never `CreateQueueCommand` — the backend never
creates a queue anywhere, local or real) and send to it. This was refactored
from an earlier version where the backend lazily called `CreateQueueCommand`
against localstack on first use; that version is gone, including the
self-healing retry-on-stale-cache logic it needed (see "Gotchas" below for
why removing that was a deliberate trade, not an oversight).

Verified against live containers in Docker Desktop, including the actual
`localstack/localstack:latest` + `LOCALSTACK_AUTH_TOKEN` path (a free
account's token, supplied by the repo's user) — the license activates
successfully on the freemium tier (`Successfully requested and activated
new license ...:freemium`), `localstack-init` creates the queue, and
send/read-back both work exactly as designed. Earlier in development, before
a real token was available, the mechanism was first verified using the
free, pre-license-merge `localstack/localstack:4.4.0` image as a stand-in
(swapped in temporarily and reverted) — a valid test since `4.4.0` and
`latest` implement the same SQS API, differing only in the license check at
container startup. Both runs confirm the same facts:

- **`localstack-init` correctly creates the queue and exits 0**, gated on
  `localstack`'s `healthcheck` via `depends_on: condition: service_healthy`.
  Confirmed live: `docker compose logs localstack-init` shows the created
  `QueueUrl` on success.
- **The backend's `GetQueueUrlCommand`-only resolution works against a
  queue it never created itself** — confirmed live: sent and read back a
  message through a queue that only `localstack-init` had touched.
- **The `QueueUrl` localstack returns uses a
  `sqs.<region>.localhost.localstack.cloud` domain, not the `localstack`
  hostname the client's `endpoint` is configured with — this does NOT
  break anything.** The SDK v3 client always connects to its configured
  `endpoint`; `QueueUrl` is just a request parameter, not something the
  SDK re-parses to decide where to connect. Confirmed live: sends worked
  fine despite the mismatched-looking URL. Worth knowing so a future
  reader doesn't "fix" this by trying to rewrite the returned URL.
- **Recovery after `docker compose restart localstack` (independent of
  `backend`) is `docker compose up localstack-init` — confirmed live, and
  it does NOT require restarting `backend` too.** localstack's queue state
  is in-memory only, so restarting it alone wipes the queue; re-running
  `localstack-init` recreates it. The backend's already-cached `QueueUrl`
  (from before the restart) becomes valid again automatically once the
  queue exists again, because SQS queue URLs are deterministic by name —
  confirmed live, no code change or backend restart needed.
- **Known rough edge, confirmed live, not fixed on purpose**: the *first*
  send that fails after an independent `localstack` restart surfaces the
  raw AWS SDK error message ("The specified queue does not exist.")
  instead of `sqsClient.js`'s friendlier wrapped message. This happens
  because that first failure occurs inside `SendMessageCommand` itself
  (using an already-cached, now-stale `QueueUrl`, so `resolveQueueUrl`'s
  own `GetQueueUrlCommand` call — and its friendly-error wrapping — never
  even runs). Not fixed, because doing so would mean re-adding
  cache-invalidation/retry logic to `sqsClient.js`, which is exactly the
  integration-layer complexity this refactor was meant to remove.
- `SERVICES=sqs` in `docker-compose.yml`'s `localstack` service env is
  still current/functional as of localstack 4.4.0 and the calendar-
  versioned 2026.x line — restricts which AWS services localstack loads.
- Real AWS: the "queue not found" error's `.name` varies across SDK
  versions/protocols (`QueueDoesNotExist`, `QueueDoesNotExistException`, or
  the legacy `AWS.SimpleQueueService.NonExistentQueue`) — the code checks
  all three, sharing the exact same `resolveQueueUrl()` helper (and error
  handling) that's confirmed working for localstack above. Not yet
  exercised against a real AWS account in this sandbox (no real
  credentials available).
- Reading a message back from the localstack queue
  (`fetchLocalstackMessages`) is **destructive** — `ReceiveMessageCommand`
  followed by `DeleteMessageCommand`, matching a real consumer, not a peek.
  This was changed from an earlier non-destructive `VisibilityTimeout: 0`
  peek design (see "Gotchas" below for why) once the UI moved from showing
  a single message to a short history. Since a destructive read leaves
  nothing in the queue to re-check, `sqsClient.js` keeps its own in-memory
  buffer of the last `MAX_HISTORY` (5) consumed messages, newest first,
  and every call to `fetchLocalstackMessages()` does one `ReceiveMessage`
  attempt, appends what it finds (if anything) to the buffer, and returns
  the whole buffer plus a `receivedNew` flag the frontend uses to know
  whether *this* poll found something new vs. is just re-displaying
  existing history. **Confirmed live**: sending N messages and repeatedly
  hitting the read-back endpoint drains them one at a time in order, the
  history accumulates correctly newest-first, and the 5-item cap holds
  (sent 7, saw exactly the last 5). This buffer is process-memory only —
  it resets on backend restart, same as the queue-URL cache above.
- Credentials are handled very differently for the two sources, on purpose:
  the localstack client uses hardcoded `test`/`test` (localstack's own
  documented dummy-credential convention; it doesn't validate them, but the
  SDK still requires *some* value) and an explicit `endpoint`/`region` —
  never the default credential chain, so real AWS credentials present in
  the container env can never accidentally hit the local mock. The real-AWS
  client uses `new SQSClient({})` with no explicit config at all, relying
  entirely on the SDK v3 default provider chain — which is why
  `docker-compose.yml` passes `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/
  `AWS_SESSION_TOKEN`/`AWS_REGION` through from `.env` into the backend
  container's environment (the SDK reads them from there, not from the
  host directly). Only `AWS_REGION` is passed, not `AWS_DEFAULT_REGION` —
  AWS SDK v3 for JavaScript's documented region-resolution chain only lists
  `AWS_REGION`. `localstack-init` (the `amazon/aws-cli` service) uses its
  own separate `test`/`test` env vars for the same reason — it's a
  different container/tool (AWS CLI, not the JS SDK), so it needs its own
  credential config even though the values are identical.
- Don't conflate the `test`/`test` SQS *API* credentials above with
  `LOCALSTACK_AUTH_TOKEN` (see "Gotchas" below) — they're unrelated layers.
  `test`/`test` is what SQS clients (both the backend's and
  `localstack-init`'s) send on every SQS call, and localstack never checks
  it. `LOCALSTACK_AUTH_TOKEN` is checked once, by the localstack
  *container* itself, before it'll start serving any requests at all — get
  that wrong and every SQS call fails the same way regardless of the API
  credentials being correct.

## Snowflake mocking facts (LocalStack for Snowflake)

Fully verified against live containers in Docker Desktop, including the
mock actually running `SELECT`/`INSERT`/`UPDATE`/`DELETE` successfully —
confirmed live end-to-end through the real UI (add via a preset, save,
edit a cell, save again, delete) once a genuine LocalStack for Snowflake
trial token was available. Getting there took a few rounds — see the
license-entitlement and `SF_HOSTNAME_REGEX` gotchas below, both of which
looked like "still broken" for a while before turning out to be one
specific, fixable cause each.

- **`localstack/snowflake` is a separate paid product from the base
  `localstack/localstack` image**, not a service flag on it — different
  Docker image, different license. It happens to share the same
  `LOCALSTACK_AUTH_TOKEN` env var name in `docker-compose.yml` (a deliberate
  choice made here to keep `.env` simpler — see the AskUserQuestion decision
  in this feature's history), but a free-tier token that works fine for the
  SQS `localstack` service will make `localstack-snowflake` fail its own
  license check with the same "License activation failed" error. A real
  LocalStack for Snowflake entitlement (30-day free trial, no card, at
  localstack.cloud/start-snowflake-trial, or a paid plan) is required for
  this specific container to ever start — confirmed live: with no token at
  all, `localstack-snowflake` exits immediately with exit code 55, byte-for-
  byte the same failure shape as the SQS `localstack` service's documented
  gotcha above. **Also confirmed live: a token can show as "freemium" on
  this container's own license check for a while even after the trial shows
  as active on the LocalStack dashboard** — several consecutive clean
  recreates (new container, non-cached license check, confirmed-fresh
  `.env` value) all resolved the same account to the same freemium license
  ID before a later attempt suddenly came back `:trial`. If this container
  logs "not covered by your license" right after you've started a trial,
  that may just be entitlement propagation lag on LocalStack's side rather
  than anything wrong locally — retrying a clean `docker compose down` +
  `up -d` later is worth doing before assuming the setup is broken.
- **Container-to-container connectivity uses `SF_HOSTNAMES`, not the
  `snowflake.localhost.localstack.cloud` DNS trick LocalStack's own docs
  lead with.** That DNS name is a public entry that resolves to `127.0.0.1`
  for *host-machine* tools (SnowSQL, DBeaver, a Python script run outside
  Docker) — it does not resolve to the `localstack-snowflake` container from
  *another* container on the same docker-compose network. The fix, taken
  from LocalStack's own `localstack-samples/localstack-snowflake-samples`
  "multi-container" example: set the `localstack-snowflake` service's
  hostname config to `localstack-snowflake`, then connect from the backend
  using that plain docker-compose service name as the `host` instead of the
  public DNS name. `backend/src/snowflakeClient.js` and `snowflake-init/init.js`
  both do this. **The sample's own env var for this, `SF_HOSTNAME_REGEX`
  (a regex pattern), turned out to be silently deprecated in the LocalStack
  version this was tested against** — confirmed live: the container logs
  `SF_HOSTNAME_REGEX is deprecated and no longer supported; use
  SF_HOSTNAMES (comma-separated list) instead` and falls back to the
  default `snowflake.localhost.localstack.cloud` hostname only, ignoring
  the regex entirely. The symptom was *not* an obvious failure: the mock
  kept returning HTTP 200 on every `POST /session/v1/login-request`, but
  `snowflake-sdk`'s `connect()` callback never fired — repeated
  login-request 200s at growing intervals in the container's logs is the
  SDK's own retry loop silently re-attempting a "successful" login it
  never considered complete, since the response didn't establish a session
  the client recognized. Fixed by switching to `SF_HOSTNAMES:
  localstack-snowflake` (exact hostname, comma-separated for multiple, no
  regex) — confirmed live this resolved both the hostname config log line
  (now correctly `hostnames=['localstack-snowflake']`) and the hang.
- **`snowflake-sdk`'s `host`/`port`/`protocol` connection options are what
  make the above possible** — `host: 'localstack-snowflake', port: 4566,
  protocol: 'http'` — plain HTTP, no TLS, matching how the SQS side talks to
  `localstack:4566` unencrypted. `account`/`username`/`password` are all
  hardcoded to `'test'` for the mock (same "some value is required, none of
  them are checked" reasoning as `sqsClient.js`'s localstack credentials).
- **The mock's database/table are provisioned by a one-shot
  `snowflake-mock-init` service (`snowflake-init/`), not by
  `snowflakeClient.js`** — same "provisioning is infra's job, not the
  integration layer's" pattern as `localstack-init` for SQS. It's a small
  standalone Node project (own `package.json`/`Dockerfile`, not part of
  `backend/`) that runs `CREATE DATABASE IF NOT EXISTS mokapi_demo`, then
  `CREATE TABLE IF NOT EXISTS mokapi_demo.PUBLIC.<SNOWFLAKE_TABLE>`, then
  seeds two default rows (`Nathan Schlechte, Green` and
  `Ashley Schlechte, Blue`) *only if the table is empty* — a `SELECT
  COUNT(*)` check first, since `localstack-snowflake` has no volume mount
  (in-memory only, see below) and this script re-runs on every `docker
  compose up`; a plain `INSERT` without that guard would duplicate the seed
  rows on every restart. Gated on `localstack-snowflake`'s healthcheck via
  `depends_on: condition: service_healthy`, then exits.
  `MOCK_DATABASE`/`MOCK_SCHEMA` are hardcoded
  constants duplicated in both `snowflake-init/init.js` and
  `backend/src/snowflakeClient.js` (can't share a module — separate
  containers/npm installs) — keep them in sync by hand if either changes.
  Not user-configurable, unlike the real side's `SNOWFLAKE_DATABASE`/
  `SNOWFLAKE_SCHEMA`, because this database only ever exists inside the
  ephemeral mock.
- **`snowflake-sdk`'s own `retryTimeout` connection option cannot be used to
  fail fast, and this bit us during live verification.** Its default is 300
  (seconds), and the SDK clamps any lower value back up to 300 via
  `Math.max(300, yourValue)` (confirmed against `connection_config.js` in
  `snowflakedb/snowflake-connector-nodejs`) — so `retryTimeout: 5` silently
  becomes `300` anyway. Confirmed live: with `localstack-snowflake` down,
  the very first "Loading…" on the Snowflake tab sat there for the full 5
  minutes before erroring, and the backend log for that attempt read
  `connection failed after 254114.4 milliseconds`. The fix,
  `connectWithTimeout()` in `snowflakeClient.js`, wraps `connection.connect()`
  in its own `Promise.race`-style timeout (`CONNECT_TIMEOUT_MS = 8000`,
  calling `connection.destroy()` and rejecting if it fires first) — this is
  an application-level timeout layered on top of the SDK, not a
  configuration of the SDK's own retry behavior. If you ever see a Snowflake
  tab request hang far longer than 8s, this is the first place to check —
  it likely means a code path is bypassing `getConnection()`/
  `connectWithTimeout()` and calling `connection.connect()` directly.
- **A related frontend bug, also only caught live**: the first version of
  `loadSnowflakeRecords()` in `app.js` left `snowflakeRecords` untouched on
  a failed fetch, so a failed reload kept showing whatever was on screen
  before — including an unsaved, never-persisted row added via "+". That
  made a client-only row look like real server data after a failed refresh.
  Fixed by clearing `snowflakeRecords = []` in the `catch` block before
  `renderSnowflakeTable()` runs. Worth remembering if the "no records" empty
  state ever seems to flicker between real content and empty on a flaky
  connection — that's the by-design behavior of this fix, not a rendering
  bug.
- **A third frontend bug, also only caught live, once real Snowflake
  credentials were available to test against**: `loadSnowflakeRecords()`
  calls weren't sequenced, so switching Source (or clicking Filter/Refresh/
  Clear) again before a prior request finished started a second,
  independent request with nothing cancelling the first. Confirmed live:
  switching from Localstack to Snowflake (real) while the mock's request
  was still in its 8s connect-timeout window showed the real source's fast
  result correctly at first, then had it silently overwritten ~7 seconds
  later when the mock's slower, now-stale request finally settled — a
  classic out-of-order-async bug. Fixed with a monotonic `snowflakeRequestId`
  counter: each call captures its own id, and both the `catch` block and
  the final `renderSnowflakeTable()` call bail out early if a newer request
  has since started. Any future change to `loadSnowflakeRecords()` should
  preserve this guard — it's easy to lose if the function is refactored to
  extract its status-update logic into a helper.
- **Query syntax changes made from the original spec, and why**: all four
  queries (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) use `snowflake-sdk`'s
  `binds` array with `?` placeholders instead of the `'${placeholder}'`
  string-interpolation shown in the original spec — parameterized binds
  avoid SQL injection and are `snowflake-sdk`'s documented way to pass
  values, whereas string-interpolating user input directly into SQL text
  would be a real vulnerability once wired to an HTTP endpoint. Separately,
  the `UPDATE` query's `WHERE` clause used `second_name` in the original
  spec, a typo — the table only has `last_name` — fixed to `last_name` in
  `updateRecord()`.
- **The frontend's "Filter only affects the next query" behavior is a
  literal reading of the spec, not a bug**: `loadSnowflakeRecords()` takes
  an optional `firstNameFilter` argument used only by the Filter form's
  submit handler — every other trigger (Refresh, Clear, and the reload
  after every successful Save/Delete) calls it with no argument, i.e.
  unfiltered. So a filtered result set stays filtered only until the next
  manual action. **Clear** exists specifically to reset the First Name
  field and reload unfiltered in one click, without needing to blank the
  field and hit Filter again. If the "revert on any other action" part is
  ever surprising in practice, the fix is tracking the "current filter" as
  state and having Refresh reuse it instead of always clearing it.
- **There is deliberately no automatic polling** — an earlier version had a
  5s `setInterval` auto-refresh with a small timing-bar progress indicator
  (paused via a `.paused` class + `animation-play-state` while a row was
  selected, to avoid clobbering an in-progress edit). That was removed in
  favor of manual-only refresh (the **Refresh** button) — every action that
  changes data (Save/Delete) still triggers its own reload, so the table
  only goes stale between an external change (e.g. a hand-edited row) and
  the next manual Refresh. If auto-refresh is ever reintroduced, the
  pause-while-selected guard (`snowflakeSelectedIndex === null` before
  fetching) is the thing to bring back first — without it, a background
  refresh will silently discard an unsaved in-progress edit.
- **The Save/Delete icon buttons live inside the table itself, in a 4th
  column** (`<td class="snowflake-actions-cell">`, one per row, empty
  unless that row is selected) — not a floating toolbar positioned outside
  the table. This replaced an earlier version that absolutely-positioned a
  toolbar at `left: 100%` relative to a wrapper div, which needed
  `getBoundingClientRect()` math on every selection change and a window
  resize listener to stay aligned with the selected row, and had to work
  around `.table-wrapper`'s `overflow-x: auto` clipping content outside its
  bounds. The in-table version gets row alignment for free from normal
  table layout instead. Mechanically: `snowflakeSaveRowBtn`/
  `snowflakeDeleteRowBtn` are two DOM elements created once (not per-row,
  not cloned) with their click listeners attached at creation — selecting a
  row moves them (`appendChild`, which re-parents rather than duplicates)
  into that row's actions cell; deselecting or any full re-render calls
  `.remove()` on both first. Since `.remove()` is a no-op when a node has no
  parent, the same call safely handles "was in row 2, now nowhere" and "was
  nowhere, still nowhere." Combined with the earlier
  `snowflakeRecords.length === 0` guard in `selectSnowflakeRow()`, this is
  also what keeps the buttons from ever rendering when the table is empty
  — there's no row to move them into.
- **Three separate layout/CSS bugs in the cell-editing UI, all only caught
  live, in this order — worth knowing the history if the styling ever gets
  touched again:**
  1. **Specificity**: `.cell-edit-input` (the input swapped into a cell on
     double-click) originally didn't override the page's generic
     `input[type="text"], ... { padding: 0.5rem 0.6rem; border: 1px solid
     var(--border); font-size: 1rem; ... }` rule from the top of
     `styles.css` — a bare class selector (specificity 0,1,0) loses to that
     rule's attribute selector (`input[type="text"]`, specificity 0,1,1)
     regardless of which one comes later in the file. Confirmed live: the
     cell measurably grew (40.66px → 56px tall) the moment editing started.
     Fixed by qualifying the selector as `input.cell-edit-input`
     (specificity 0,1,1, ties the generic rule, wins on source order).
  2. **Table auto-layout width instability**: even after fixing the height,
     the *width* of the column being edited still jumped (confirmed live:
     163px → 272px, stealing space from the other columns) — an `<input>`'s
     own intrinsic preferred width factors into the table's automatic
     column-width algorithm regardless of the input's own
     `width: 100%`/`min-width: 0`. An attempted fix — capturing the cell's
     current pixel width in JS and setting it as the input's explicit
     inline width before inserting it — still didn't stop the reflow.
  3. **The actual fix**: `#snowflake-table { table-layout: fixed; }` plus
     an explicit `<colgroup>` in `index.html` (26%/26%/30%/18%) locks
     column widths from that declaration instead of ever recalculating them
     from cell content — confirmed live, both height and width now stay
     byte-identical before/after entering edit mode, for any cell. The
     `<td>`/`<th>` also got `overflow: hidden; text-overflow: ellipsis;` as
     a consequence — fixed layout means a value longer than its column
     truncates with an ellipsis instead of forcing the column wider;
     confirmed live the underlying value (`snowflakeRecords[i][field]`) is
     still captured in full, only the on-screen text is visually
     shortened. If a future change needs a 5th column or different
     proportions, update the `<colgroup>` widths, not just the `<th>`s —
     with `table-layout: fixed` the `<colgroup>` (or first-row cell widths,
     absent one) is the *only* thing that determines column widths.
- **Row background lives on the `<tr>` (`.snowflake-row`), not on
  individual `<td>`s** — an earlier per-cell-background version (shading
  just the three editable columns) caused two visible bugs the user
  flagged directly: the shade stopped short of the row's right edge
  (the actions column had no background of its own, so it looked like a
  seam), and hover/selected only visibly changed whichever column *didn't*
  have its own background override, since a `<td>`'s own background paints
  over its parent `<tr>`'s wherever both exist. Moving the background to
  one property on one element (the `<tr>`) fixes both: it always spans the
  full row, and hover/selected cleanly replace it since nothing underneath
  is fighting for the same pixels. The actively-edited cell still gets its
  own distinct call-out via the input's `outline` (not `background`,
  and not `border` — outline never participates in box sizing/layout, so
  it can highlight the cell without risking reintroducing bug #1 above) —
  see `--editing-bg`/`--accent` usage in `input.cell-edit-input`.
- **The preset buttons live in a `<fieldset>` with a `<legend>Presets</legend>`**,
  not a plain `<div>` — gets a labeled, bordered container for free from
  semantic HTML instead of hand-building one, styled via
  `.snowflake-preset-group` to match this app's existing border/radius
  language rather than the browser's default fieldset look.
- **All three preset buttons ("Kung Fu Panda", "Randomize", "Another
  Schlechte", top to bottom) reuse the exact same code path as "+"** — a
  shared `addSnowflakeRow(overrides)` helper pushes `{ firstName: '',
  lastName: '', favoriteColor: '', ...overrides, original: null, isNew:
  true }`, so all four controls produce an identical kind of row
  (client-side only, selected, nothing sent to the server until the user
  clicks the save icon themselves) and differ only in which fields
  `overrides` pre-fills:
  - **"Kung Fu Panda"** → `{ firstName: 'Jack', lastName: 'Black',
    favoriteColor: 'White' }` — Po is voiced by Jack Black, and pandas are
    black *and* white, so first+last name spell out the actor's real name
    while favoriteColor picks up the panda's other color instead of
    repeating "Black". A 3-field pun, suggested as a replacement for an
    initial 2-field version (`firstName: 'Jack', favoriteColor: 'Black'`,
    last name left blank) and confirmed as the preferred version.
  - **"Randomize"** picks one random value per field from three static
    arrays (`SNOWFLAKE_RANDOM_FIRST_NAMES`/`_LAST_NAMES`/`_COLORS` in
    `app.js`, deliberately simple top-level arrays — edit them directly to
    change the pool, no config file or build step involved). First names
    are the SSA's reported top 10 boys' + top 10 girls' names for 2025
    (ssa.gov/oact/babynames); last names are the 10 most common US
    surnames per the 2020 Census
    (census.gov/library/stories/2026/04/2020-census-names-data.html);
    colors are just a reasonable hand-picked list, not sourced from
    anything.
  - **"Another Schlechte"** → `{ firstName: 'No', lastName: 'Way' }` — an
    earlier version instead set `{ lastName: 'Schlechte', favoriteColor:
    'Green' }`; changed on request, and the button's label no longer
    literally matches what it fills in (a deliberate choice, not a stale
    label left behind by accident).
- **A row with unsaved changes gets flagged once it's no longer selected**
  — `isSnowflakeRowDirty()` treats any `isNew: true` row (never saved) as
  dirty unconditionally, and any existing row as dirty if its current
  `firstName`/`lastName`/`favoriteColor` differ from `record.original`
  (which now captures all three fields as loaded, not just the
  `firstName`/`lastName` the UPDATE/DELETE WHERE clause needs — extended
  specifically to make this comparison possible). `updateSnowflakeDirtyHighlights()`
  re-applies the `.dirty` class to every row *except* the currently
  selected one on every selection change, and reuses `--editing-bg` (the
  same amber as the actively-edited cell) rather than a new color, so
  "amber" consistently means "has changes you haven't saved" whether
  that's the one cell you're typing into or a whole row you've since
  clicked away from. Deliberately does *not* fire on every keystroke —
  only on selection change — since the point is warning about data that
  would be lost by navigating away, not live-validating as you type.
- **A real data-loss bug, caught live: `loadSnowflakeRecords()` used to
  wholesale-replace `snowflakeRecords` with the server's response on every
  reload** — including the automatic reload after a successful Save/Delete.
  Confirmed live: adding 4 unsaved rows, saving just one, and reload wiped
  out the other 3, since only the just-saved row (now real) and whatever
  was already on the server came back in that response; the 3 still-local
  rows were never part of it. Fixed by having `loadSnowflakeRecords()`
  merge the fresh server response with `previousRecords.filter(isSnowflakeRowDirty)`
  — any row still genuinely unsaved rides along across the reload instead
  of being silently discarded. This applies to *every* reload path
  (Refresh/Filter/Clear/switching Source/post-Save/post-Delete), not just
  the one that was reported, since they all funnel through this one
  function. Two callers need to cooperate for this to not create a stale
  duplicate of the row they just persisted: `saveSelectedSnowflakeRow()`
  updates `record.original` and clears `record.isNew` *before* calling
  `loadSnowflakeRecords()` (so the just-saved row reads as clean and gets
  excluded from the merge — the fresh copy from the server is what
  survives instead), and `deleteSelectedSnowflakeRow()` splices the row out
  of `snowflakeRecords` before reloading (so a deleted-but-previously-dirty
  row doesn't get resurrected by the merge). The failed-reload path
  (`catch` block) was adjusted the same way — instead of clearing to `[]`,
  it now keeps `previousRecords.filter(isSnowflakeRowDirty)`, dropping only
  the previously-loaded *clean* rows (now an unconfirmed cache of server
  state) while keeping local-only work intact. Any future change to
  `loadSnowflakeRecords()`, `saveSelectedSnowflakeRow()`, or
  `deleteSelectedSnowflakeRow()` needs to preserve this clean-before-reload
  handshake, or this bug comes back.
- **The Presets `<fieldset>` needed a hand-tuned `margin-top: 24px` to
  visually align with the table's column headers** — a `<legend>` straddles
  its fieldset's top border by design, which extends the *element's own
  bounding box* that far above the visible border line. Flexbox
  `align-items: flex-start` (in `.snowflake-table-row`) aligns that
  extended box against the table wrapper, which visually lines the legend
  text up with the headers instead of the fieldset's actual visible box.
  Confirmed live the 24px margin brings the two into exact alignment
  (0px difference in `getBoundingClientRect().top`). This value tracks the
  legend's rendered height (`font-size: 0.85rem` + its line-height) — if
  that font-size ever changes, re-measure rather than assuming 24px still
  holds.

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
  `pageSections`. The AWS tab is the concrete example of this: a
  `data-page="aws"` button, `#page-aws` section, `aws` entry in
  `pageSections`, and its own send + read-back cards mirroring the Email
  tab's structure.
- **Ports**: mokapi dashboard/mail-API is 8080, mock weather API is 8090
  (set via the `servers` entry in `openapi.yaml`), mock SMTP is 2525 (set in
  `mail.yaml`), localstack SQS edge is 4566, localstack-snowflake edge is
  4567 host-side (still 4566 container-internal — only the host mapping
  differs, to avoid colliding with the SQS localstack service's own 4566),
  backend/UI is 3000. These are host-side mappings only, overridable
  per-checkout via `BACKEND_PORT`, `MOKAPI_DASHBOARD_PORT`,
  `MOKAPI_API_PORT`, `MOKAPI_SMTP_PORT`, `LOCALSTACK_PORT`,
  `SNOWFLAKE_LOCALSTACK_PORT` in `.env` (see `docker-compose.yml`) — this is
  what lets multiple git worktrees run their stacks concurrently.
  Container-internal traffic (e.g. backend reaching mokapi at
  `http://mokapi:8090/current`, `mokapi:2525` for SMTP, `localstack:4566`
  for SQS, or `localstack-snowflake:4566` for Snowflake) uses the container
  port and is unaffected by these overrides.

## Working in a git worktree

**Run `node scripts/setup-worktree-env.js` automatically, without being
asked, whenever you set up a new worktree for this repo** (e.g. right after
`git worktree add`, before the first `docker compose up` in that worktree).
It creates `.env` from `.env.example` if missing and assigns that worktree a
non-colliding `BACKEND_PORT`/`MOKAPI_DASHBOARD_PORT`/`MOKAPI_API_PORT`/
`MOKAPI_SMTP_PORT`/`LOCALSTACK_PORT`/`SNOWFLAKE_LOCALSTACK_PORT` based on its
position in `git worktree list`. Skipping this is the main way a
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

The AWS tab's SQS mocking (`docker-compose.yml`'s `localstack` service,
`backend/src/sqsClient.js`) has since been run against a live Docker Desktop
environment. One real bug turned up (item 3), plus two rounds of deliberate
architectural change made after initial verification (items 4–6, kept here
rather than rewritten away so a future refactor has the full history and
doesn't rediscover the same trade-offs from scratch):

3. **`localstack/localstack:latest` requires a free-tier auth token and
   refuses to start without one.** As of March 23 2026, localstack merged
   its Community and Pro Docker images into one — `:latest` now runs a
   license check on startup and exits with "License activation failed...
   No credentials were found in the environment" unless
   `LOCALSTACK_AUTH_TOKEN` is set, which requires signing up for a free
   localstack.cloud account (no paid plan needed). `docker-compose.yml`'s
   `localstack` service passes `LOCALSTACK_AUTH_TOKEN` through from `.env`
   (see `.env.example`) — this is now a required credential for the AWS
   tab's "Localstack" option specifically, unlike every other "local mock"
   option in this repo, which needs zero credentials. An earlier version of
   this fix pinned the image to `localstack/localstack:4.4.0` (the last
   pre-merge Community-only release) to avoid the signup entirely; that was
   reverted in favor of `:latest` + the token, to stay on a maintained
   image rather than accumulate version drift. If localstack changes its
   licensing again, `docs.localstack.cloud/aws/getting-started/auth-token/`
   documents the current policy. **Confirmed live with a real free-account
   token**: startup logs show `Successfully requested and activated new
   license ...:freemium`, and the full send/read-back flow works
   end-to-end on the unpinned `:latest` image.
4. **The cached localstack `QueueUrl` went stale after restarting the
   `localstack` container independently of `backend`.** localstack's queue
   state is in-memory only (no persistence configured), so a
   `docker compose restart localstack` wipes the queue the backend had
   already created and cached — every subsequent send/read then failed with
   `err.name === 'QueueDoesNotExist'` until the backend itself was also
   restarted. **Originally fixed** in `backend/src/sqsClient.js` by
   wrapping every localstack call in a helper that caught exactly that
   error, cleared the cache, and retried once (re-running `CreateQueue`).
   **That fix was deliberately removed** in a later pass — see item 5
   below for why, and "AWS SQS mocking facts" above for how the queue gets
   created and how to recover now instead.
5. **Architectural change: queue creation moved from `sqsClient.js` into
   docker-compose, on purpose, trading away the self-healing behavior from
   item 4.** The call was made that provisioning a queue's existence isn't
   the integration layer's job — same reasoning as why the real-AWS path
   never creates a queue either, just applied consistently to both sources
   now. `docker-compose.yml`'s `localstack-init` service (an `amazon/aws-cli`
   one-shot container, gated on `localstack`'s healthcheck) creates the
   queue instead; `sqsClient.js` only ever calls `GetQueueUrlCommand` for
   both sources. The trade: if `localstack` restarts independently of
   `backend`, there's no more automatic retry-and-recreate — recovery is a
   manual (if simple) `docker compose up localstack-init`, confirmed live
   to work without needing to restart `backend` too (see "AWS SQS mocking
   facts" for why: SQS queue URLs are deterministic by name, so the
   backend's stale cache becomes valid again once the queue exists again).
   This was a deliberate, discussed trade-off, not an oversight — flagging
   it here so a future refactor doesn't "fix" it by reintroducing the
   removed retry logic without reconsidering the trade first.

6. **Read-back changed from a non-destructive peek to a destructive
   read + in-memory history.** The original design used
   `VisibilityTimeout: 0` specifically so a single displayed message
   survived repeated Refreshes without being consumed. Once the UI needed
   to show a scrollable history of the last 5 messages instead of just the
   latest one, a true peek no longer made sense — there was nothing about
   "don't consume" that helped once the backend needed to track history
   itself anyway. Switched to `ReceiveMessageCommand` + `DeleteMessageCommand`
   (matching a real consumer) with the history kept in an in-memory buffer
   in `sqsClient.js` — see "AWS SQS mocking facts" above. This also
   incidentally resolves the earlier documented "known limitation" that
   sending twice via Localstack without refreshing made the next Refresh's
   result non-deterministic: destructive reads mean each read/poll drains
   exactly one message in the order the queue delivers them, so the
   history now reflects real send order rather than "whichever message a
   non-destructive peek happened to see."

`GetQueueUrl`-based resolution (for both sources, sharing one code path)
and the destructive-read-plus-history design were both confirmed working
as designed — see "AWS SQS mocking facts" above for specifics on what was
actually run live versus what's still inferred from shared code.

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
- Standard SQS queue, not FIFO — a FIFO queue would require a `.fifo`-
  suffixed name and a `MessageGroupId` on every send, adding complexity for
  no real benefit here: reads are destructive and one-at-a-time, so the
  backend's history buffer reflects actual drain order regardless of
  strict FIFO guarantees.
- Localstack message history is capped at 5 and kept in `sqsClient.js`'s
  process memory, not persisted — by design, matching this repo's
  "no database" philosophy elsewhere. It resets on backend restart; that's
  fine for a demo.
- No queue auto-provisioning in application code, for **either** source —
  `backend/src/sqsClient.js` only ever calls `GetQueueUrl`, never
  `CreateQueue`. For real AWS, provisioning is the user's job (see
  README's "Provisioning the real SQS queue"). For localstack, it's
  `docker-compose.yml`'s one-shot `localstack-init` service, not the
  backend — a deliberate choice to keep the integration layer from
  concerning itself with whether its dependencies exist, treating that as
  an infra/test-setup concern instead (see "Gotchas" item 5).
- No automatic recovery if `localstack` is restarted independently of the
  rest of the stack — `docker compose up localstack-init` fixes it (see
  "Gotchas" item 5 and "AWS SQS mocking facts" for why that's sufficient
  without also restarting `backend`), but it's a manual step, not
  something the app retries on its own. This was a deliberate trade against
  an earlier self-healing version of `sqsClient.js`.
- No formal primary key on the `person` table — `first_name` + `last_name`
  are treated as one by the UI/queries (an update or delete could match more
  than one row if they collide), a known, accepted limitation per the
  original requirements rather than something to harden.
- Real Snowflake auth is username/password only, no key-pair or OAuth —
  matches this repo's existing pattern for "the one real external
  credential this tab needs" (see `GMAIL_USER`/`GMAIL_APP_PASSWORD` for
  Email, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for AWS). Requires
  password auth to be enabled on the Snowflake user; key-pair auth would be
  the fix if that's ever a blocker.
- No pagination on the Snowflake tab's table — every source/filter query
  returns and renders the full result set. Fine for a demo-sized `person`
  table; would need a `LIMIT`/cursor if this table ever grew large.
- Filtering by First Name is intentionally not "sticky" — see "Snowflake
  mocking facts" above. This was a literal reading of the original
  requirements, not an oversight; flagged there as the first thing to
  revisit if it's surprising in practice.
