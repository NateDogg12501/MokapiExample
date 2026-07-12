import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWeather } from './src/weatherClient.js'
import { normalizeWeatherResponse } from './src/normalize.js'
import { listScenarios, upsertScenario, deleteScenario } from './src/scenarioStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'frontend')))

app.get('/api/weather', async (req, res) => {
    const city = String(req.query.city || '').trim()
    const source = req.query.source

    if (!city) {
        return res.status(400).json({ status: 'error', httpStatusCode: 400, errorCode: null, errorInfo: 'city is required' })
    }
    if (source !== 'hosted' && source !== 'mock') {
        return res.status(400).json({ status: 'error', httpStatusCode: 400, errorCode: null, errorInfo: 'source must be "hosted" or "mock"' })
    }

    const isHosted = source === 'hosted'
    const baseUrl = isHosted
        ? process.env.WEATHERSTACK_BASE_URL || 'http://api.weatherstack.com/current'
        : process.env.MOKAPI_URL || 'http://mokapi:8090/current'
    const accessKey = isHosted ? process.env.WEATHERSTACK_ACCESS_KEY || '' : 'mock'

    try {
        const { httpStatus, body } = await fetchWeather(baseUrl, accessKey, city)
        res.json(normalizeWeatherResponse(httpStatus, body))
    } catch (err) {
        res.status(502).json({
            status: 'error',
            httpStatusCode: 502,
            errorCode: null,
            errorInfo: `Could not reach ${source} weather service: ${err.message}`
        })
    }
})

app.get('/api/scenarios', async (req, res) => {
    res.json(await listScenarios())
})

app.put('/api/scenarios/:city', async (req, res) => {
    try {
        const scenario = await upsertScenario(req.params.city, req.body)
        res.json(scenario)
    } catch (err) {
        res.status(400).json({ error: err.message })
    }
})

app.delete('/api/scenarios/:city', async (req, res) => {
    await deleteScenario(req.params.city)
    res.status(204).end()
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`)
})
