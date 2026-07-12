import fs from 'node:fs/promises'

const SCENARIOS_PATH = process.env.SCENARIOS_FILE_PATH || '/mokapi-data/scenarios.json'

async function readScenarios() {
    try {
        const raw = await fs.readFile(SCENARIOS_PATH, 'utf-8')
        return JSON.parse(raw)
    } catch (err) {
        if (err.code === 'ENOENT') return {}
        throw err
    }
}

async function writeScenarios(scenarios) {
    await fs.writeFile(SCENARIOS_PATH, JSON.stringify(scenarios, null, 2))
}

function validateScenario(input) {
    const responseCode = Number(input.responseCode)
    if (responseCode !== 200 && responseCode !== 400) {
        throw new Error('responseCode must be 200 or 400')
    }

    if (responseCode === 200) {
        const temperature = Number(input.temperature)
        if (!input.cityName || Number.isNaN(temperature)) {
            throw new Error('cityName and temperature are required for a 200 scenario')
        }
        return { responseCode, cityName: String(input.cityName), temperature }
    }

    const errorCode = Number(input.errorCode)
    if (Number.isNaN(errorCode) || !input.errorInfo) {
        throw new Error('errorCode and errorInfo are required for a 400 scenario')
    }
    return { responseCode, errorCode, errorInfo: String(input.errorInfo) }
}

export async function listScenarios() {
    const scenarios = await readScenarios()
    return Object.entries(scenarios).map(([city, scenario]) => ({ city, ...scenario }))
}

export async function upsertScenario(cityKeyRaw, input) {
    const cityKey = String(cityKeyRaw || '').trim().toLowerCase()
    if (!cityKey) throw new Error('city is required')

    const validated = validateScenario(input)
    const scenarios = await readScenarios()
    scenarios[cityKey] = validated
    await writeScenarios(scenarios)
    return { city: cityKey, ...validated }
}

export async function deleteScenario(cityKeyRaw) {
    const cityKey = String(cityKeyRaw || '').trim().toLowerCase()
    const scenarios = await readScenarios()
    delete scenarios[cityKey]
    await writeScenarios(scenarios)
}
