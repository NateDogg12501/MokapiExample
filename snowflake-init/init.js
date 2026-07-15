import snowflake from 'snowflake-sdk'

// Mirrors the mock-side constants in backend/src/snowflakeClient.js — the two
// can't share a module (separate containers/npm installs), so keep them in
// sync by hand if either changes. Not user-configurable: this database only
// ever exists inside the ephemeral localstack-snowflake mock, unlike the real
// Snowflake database/schema, which the user already has and configures via
// SNOWFLAKE_DATABASE/SNOWFLAKE_SCHEMA in .env.
const MOCK_DATABASE = 'mokapi_demo'
const MOCK_SCHEMA = 'PUBLIC'

const MOCK_HOST = process.env.SNOWFLAKE_MOCK_HOST || 'localstack-snowflake'
const MOCK_PORT = Number(process.env.SNOWFLAKE_MOCK_PORT || 4566)
const TABLE = process.env.SNOWFLAKE_TABLE || 'person'

function connect() {
    return new Promise((resolve, reject) => {
        const connection = snowflake.createConnection({
            host: MOCK_HOST,
            port: MOCK_PORT,
            protocol: 'http',
            account: 'test',
            username: 'test',
            password: 'test'
        })
        connection.connect((err, conn) => (err ? reject(err) : resolve(conn)))
    })
}

function execute(connection, sqlText, binds) {
    return new Promise((resolve, reject) => {
        connection.execute({
            sqlText,
            binds,
            complete: (err, stmt, rows) => (err ? reject(err) : resolve(rows))
        })
    })
}

// The localstack-snowflake container can report its healthcheck as passing
// slightly before it's actually ready to serve SQL — retry a few times
// rather than requiring a hand restart the way the SQS side sometimes does.
async function connectWithRetry(attempts = 10, delayMs = 3000) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await connect()
        } catch (err) {
            if (attempt === attempts) throw err
            console.log(`Connect attempt ${attempt}/${attempts} failed (${err.message}), retrying in ${delayMs}ms…`)
            await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
    }
}

const connection = await connectWithRetry()
await execute(connection, `CREATE DATABASE IF NOT EXISTS ${MOCK_DATABASE}`)
await execute(connection, `CREATE TABLE IF NOT EXISTS ${MOCK_DATABASE}.${MOCK_SCHEMA}.${TABLE} (
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    favorite_color VARCHAR(30)
)`)

// This container's data is in-memory only (see docker-compose.yml — no
// volume mount for localstack-snowflake), so it re-runs and hits an
// already-populated table on every `docker compose up`, not just the first.
// The row-count check keeps seeding idempotent instead of appending
// duplicates on each restart.
const [{ ROW_COUNT }] = await execute(connection, `SELECT COUNT(*) AS ROW_COUNT FROM ${MOCK_DATABASE}.${MOCK_SCHEMA}.${TABLE}`)
if (Number(ROW_COUNT) === 0) {
    await execute(
        connection,
        `INSERT INTO ${MOCK_DATABASE}.${MOCK_SCHEMA}.${TABLE} (first_name, last_name, favorite_color) VALUES (?, ?, ?), (?, ?, ?)`,
        ['Nathan', 'Schlechte', 'Green', 'Ashley', 'Schlechte', 'Blue']
    )
    console.log('Seeded default person rows: Nathan Schlechte (Green), Ashley Schlechte (Blue)')
}

console.log(`Mock Snowflake table ready: ${MOCK_DATABASE}.${MOCK_SCHEMA}.${TABLE}`)
process.exit(0)
