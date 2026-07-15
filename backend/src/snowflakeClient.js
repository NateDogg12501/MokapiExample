import snowflake from 'snowflake-sdk'

// Mirrors the constants in snowflake-init/init.js — the two can't share a
// module (separate containers/npm installs), so keep them in sync by hand
// if either changes. Not user-configurable: this database only ever exists
// inside the ephemeral localstack-snowflake mock, unlike the real Snowflake
// database/schema, which the user already has and configures via
// SNOWFLAKE_DATABASE/SNOWFLAKE_SCHEMA in .env.
const MOCK_DATABASE = 'mokapi_demo'
const MOCK_SCHEMA = 'PUBLIC'

// Table name is the one piece of schema shared between both sources — the
// mock's table is provisioned with this exact name by snowflake-init/init.js,
// and the real table (created out-of-band by the user, same as the real SQS
// queue in sqsClient.js) must already exist under this name.
const TABLE = process.env.SNOWFLAKE_TABLE || 'person'

function createMockConnection() {
    // localstack-snowflake doesn't validate credentials but the SDK still
    // requires *some* value — 'test' is localstack's own documented
    // convention (same reasoning as sqsClient.js's localstack client).
    return snowflake.createConnection({
        host: process.env.SNOWFLAKE_MOCK_HOST || 'localstack-snowflake',
        port: Number(process.env.SNOWFLAKE_MOCK_PORT || 4566),
        protocol: 'http',
        account: 'test',
        username: 'test',
        password: 'test',
        database: MOCK_DATABASE,
        schema: MOCK_SCHEMA
    })
}

function createRealConnection() {
    return snowflake.createConnection({
        account: process.env.SNOWFLAKE_ACCOUNT,
        username: process.env.SNOWFLAKE_USERNAME,
        password: process.env.SNOWFLAKE_PASSWORD,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        database: process.env.SNOWFLAKE_DATABASE,
        schema: process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
        role: process.env.SNOWFLAKE_ROLE || undefined
    })
}

// snowflake-sdk's own retryTimeout connection option can't be used to fail
// fast: its default is 300s and the SDK clamps any lower value back up to
// 300 via Math.max(300, yours) (verified against connection_config.js in
// snowflakedb/snowflake-connector-nodejs) — so an unreachable host (e.g.
// localstack-snowflake down, or a bad SNOWFLAKE_ACCOUNT) would otherwise
// hang every request for up to 5 minutes before erroring. This wraps
// connect() in its own bounded timeout instead, confirmed live against a
// deliberately-unreachable mock: without this, the Snowflake tab's first
// load just spins forever; with it, a clear error surfaces in ~8s.
const CONNECT_TIMEOUT_MS = 8000

function connectWithTimeout(connection) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            connection.destroy(() => {})
            reject(new Error(`Timed out connecting after ${CONNECT_TIMEOUT_MS / 1000}s`))
        }, CONNECT_TIMEOUT_MS)

        connection.connect((err, conn) => {
            clearTimeout(timer)
            if (err) reject(err)
            else resolve(conn)
        })
    })
}

// A Snowflake connection is a long-lived session, not a stateless HTTP
// client — resolved once per source and reused, same lazy-singleton shape
// as sqsClient.js's client getters. Cleared on connect failure so the next
// call retries; a connection that dies *after* connecting (e.g. a session
// timeout) is not retried automatically and will keep failing until the
// backend restarts — an accepted trade-off for this demo, same spirit as
// the SQS queue-URL cache never invalidating on its own.
const connectionPromises = new Map()

function getConnection(source) {
    if (!connectionPromises.has(source)) {
        const connection = source === 'snowflake' ? createRealConnection() : createMockConnection()
        connectionPromises.set(
            source,
            connectWithTimeout(connection).catch((err) => {
                connectionPromises.delete(source)
                throw err
            })
        )
    }
    return connectionPromises.get(source)
}

function execute(connection, sqlText, binds) {
    return new Promise((resolve, reject) => {
        connection.execute({
            sqlText,
            binds,
            complete: (err, stmt, rows) => (err ? reject(err) : resolve(rows || []))
        })
    })
}

async function runQuery(source, sqlText, binds) {
    const connection = await getConnection(source)
    return execute(connection, sqlText, binds)
}

// Snowflake returns column names uppercased (unquoted identifiers are
// normalized to uppercase) — normalize into the same camelCase shape the
// frontend works with everywhere else, matching normalize.js's role for
// the REST tab.
function toRecord(row) {
    return { firstName: row.FIRST_NAME, lastName: row.LAST_NAME, favoriteColor: row.FAVORITE_COLOR }
}

export async function listRecords(source, firstNameFilter) {
    const sqlText = firstNameFilter
        ? `SELECT * FROM ${TABLE} WHERE first_name = ?`
        : `SELECT * FROM ${TABLE}`
    const rows = await runQuery(source, sqlText, firstNameFilter ? [firstNameFilter] : undefined)
    return rows.map(toRecord)
}

export async function insertRecord(source, { firstName, lastName, favoriteColor }) {
    await runQuery(
        source,
        `INSERT INTO ${TABLE} (first_name, last_name, favorite_color) VALUES (?, ?, ?)`,
        [firstName, lastName, favoriteColor]
    )
}

// WHERE matches the row's *pre-edit* first/last name so a rename still finds
// the right row — the frontend tracks each row's original values separately
// from in-progress cell edits for exactly this reason. Uses last_name (not
// the second_name typo from the original spec) to match the actual schema.
export async function updateRecord(source, { oldFirstName, oldLastName, firstName, lastName, favoriteColor }) {
    await runQuery(
        source,
        `UPDATE ${TABLE} SET first_name = ?, last_name = ?, favorite_color = ? WHERE first_name = ? AND last_name = ?`,
        [firstName, lastName, favoriteColor, oldFirstName, oldLastName]
    )
}

// first_name + last_name are the de facto (not formally constrained) key —
// see README/CLAUDE.md for the accepted "could match more than one row"
// trade-off the user signed off on.
export async function deleteRecord(source, { firstName, lastName }) {
    await runQuery(source, `DELETE FROM ${TABLE} WHERE first_name = ? AND last_name = ?`, [firstName, lastName])
}
