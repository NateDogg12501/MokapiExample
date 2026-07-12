import { on } from 'mokapi'
import { read } from 'mokapi/file'

function loadScenarios() {
    try {
        return JSON.parse(read('./scenarios.json'))
    } catch (e) {
        return {}
    }
}

export default function () {
    on('http', function (request, response) {
        if (request.operationId !== 'getCurrentWeather') {
            return
        }

        const cityInput = request.query.query || ''
        const key = cityInput.trim().toLowerCase()
        const scenarios = loadScenarios()
        const scenario = scenarios[key]

        if (!scenario) {
            // No scenario defined for this city: fall back to a generic
            // successful response so the mock never hard-fails on unknown input.
            response.rebuild(200)
            response.data = {
                request: { type: 'City', query: cityInput, language: 'en', unit: 'f' },
                location: {
                    name: cityInput,
                    country: 'United States of America',
                    region: '',
                    timezone_id: ''
                },
                current: { temperature: 70 }
            }
            return
        }

        if (scenario.responseCode === 400) {
            response.rebuild(400)
            response.data = {
                success: false,
                error: {
                    code: scenario.errorCode,
                    type: 'mock_error',
                    info: scenario.errorInfo
                }
            }
        } else {
            response.rebuild(200)
            response.data = {
                request: { type: 'City', query: cityInput, language: 'en', unit: 'f' },
                location: {
                    name: scenario.cityName,
                    country: 'United States of America',
                    region: '',
                    timezone_id: ''
                },
                current: { temperature: scenario.temperature }
            }
        }
    })
}
