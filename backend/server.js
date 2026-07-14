import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWeather } from './src/weatherClient.js'
import { normalizeWeatherResponse } from './src/normalize.js'
import { listScenarios, upsertScenario, deleteScenario } from './src/scenarioStore.js'
import { sendEmail, fetchMokapiInboxMessage } from './src/emailClient.js'
import { sendMessage, fetchLocalstackMessages } from './src/sqsClient.js'

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

app.post('/api/email/send', async (req, res) => {
    const to = String(req.body?.to || '').trim()
    const body = String(req.body?.body || '')
    const provider = req.body?.provider

    if (!to) {
        return res.status(400).json({ status: 'error', errorInfo: 'Recipient email is required' })
    }
    if (provider !== 'google' && provider !== 'mokapi') {
        return res.status(400).json({ status: 'error', errorInfo: 'provider must be "google" or "mokapi"' })
    }

    try {
        await sendEmail(provider, to, body)
        res.json({ status: 'success', provider, to })
    } catch (err) {
        res.status(502).json({ status: 'error', errorInfo: err.message })
    }
})

app.get('/api/email/mokapi-inbox/:address', async (req, res) => {
    try {
        const message = await fetchMokapiInboxMessage(req.params.address)
        res.json(message ? { status: 'found', message } : { status: 'empty' })
    } catch (err) {
        res.status(502).json({ status: 'error', errorInfo: `Could not reach mokapi mail API: ${err.message}` })
    }
})

app.post('/api/aws/send', async (req, res) => {
    const body = String(req.body?.body || '').trim()
    const source = req.body?.source

    if (!body) {
        return res.status(400).json({ status: 'error', errorInfo: 'Message body is required' })
    }
    if (source !== 'aws' && source !== 'localstack') {
        return res.status(400).json({ status: 'error', errorInfo: 'source must be "aws" or "localstack"' })
    }

    try {
        await sendMessage(source, body)
        res.json({ status: 'success', source })
    } catch (err) {
        res.status(502).json({ status: 'error', errorInfo: err.message })
    }
})

app.get('/api/aws/localstack-inbox', async (req, res) => {
    try {
        const { messages, receivedNew } = await fetchLocalstackMessages()
        res.json(messages.length > 0 ? { status: 'found', messages, receivedNew } : { status: 'empty' })
    } catch (err) {
        res.status(502).json({ status: 'error', errorInfo: `Could not reach localstack SQS: ${err.message}` })
    }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`)
})
