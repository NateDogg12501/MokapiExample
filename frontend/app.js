const lookupForm = document.getElementById('lookup-form')
const lookupResult = document.getElementById('lookup-result')
const lookupSubmit = document.getElementById('lookup-submit')

const scenarioForm = document.getElementById('scenario-form')
const scenarioResponseCode = document.getElementById('scenario-response-code')
const scenarioSuccessFields = document.getElementById('scenario-success-fields')
const scenarioErrorFields = document.getElementById('scenario-error-fields')
const scenarioFormError = document.getElementById('scenario-form-error')
const scenarioFormSuccess = document.getElementById('scenario-form-success')
const scenarioSubmit = document.getElementById('scenario-submit')
const scenarioTableBody = document.getElementById('scenario-table-body')
const scenarioEmptyState = document.getElementById('scenario-empty-state')

let successToastTimer = null

// --- Weather lookup ---------------------------------------------------

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const city = document.getElementById('city-input').value.trim()
  const source = lookupForm.querySelector('input[name="source"]:checked').value
  if (!city) return

  lookupResult.hidden = true
  setLoading(lookupSubmit, true, 'Checking…')

  try {
    const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}&source=${encodeURIComponent(source)}`)
    const data = await res.json()
    renderLookupResult(data)
  } catch (err) {
    renderLookupResult({ status: 'error', httpStatusCode: 0, errorCode: null, errorInfo: `Request failed: ${err.message}` })
  } finally {
    setLoading(lookupSubmit, false, 'Get Weather')
  }
})

function renderLookupResult(data) {
  lookupResult.textContent = ''
  // Re-trigger the fade-in animation on repeated lookups.
  lookupResult.hidden = false
  lookupResult.style.animation = 'none'
  void lookupResult.offsetWidth
  lookupResult.style.animation = ''

  if (data.status === 'success') {
    lookupResult.className = 'result success'
    appendLine(lookupResult, 'Success!')
    appendLine(lookupResult, `City: ${data.city}`)
    appendLine(lookupResult, `Temperature: ${data.temperatureF}°F`)
  } else {
    lookupResult.className = 'result error'
    appendLine(lookupResult, `HTTP Status: ${data.httpStatusCode}`)
    appendLine(lookupResult, `Error Code: ${data.errorCode ?? 'n/a'}`)
    appendLine(lookupResult, `Info: ${data.errorInfo}`)
  }
}

function appendLine(container, text) {
  const p = document.createElement('p')
  p.textContent = text
  container.appendChild(p)
}

function setLoading(button, isLoading, label) {
  button.disabled = isLoading
  button.textContent = label
}

// --- Scenario management ----------------------------------------------

scenarioResponseCode.addEventListener('change', updateScenarioFieldVisibility)
updateScenarioFieldVisibility()

function updateScenarioFieldVisibility() {
  const isSuccess = scenarioResponseCode.value === '200'
  scenarioSuccessFields.hidden = !isSuccess
  scenarioErrorFields.hidden = isSuccess
}

scenarioForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  scenarioFormError.hidden = true
  scenarioFormSuccess.hidden = true

  const city = document.getElementById('scenario-city').value.trim()
  const responseCode = Number(scenarioResponseCode.value)

  const payload = { responseCode }
  if (responseCode === 200) {
    payload.cityName = document.getElementById('scenario-city-name').value.trim()
    payload.temperature = Number(document.getElementById('scenario-temperature').value)
  } else {
    payload.errorCode = Number(document.getElementById('scenario-error-code').value)
    payload.errorInfo = document.getElementById('scenario-error-info').value.trim()
  }

  setLoading(scenarioSubmit, true, 'Saving…')

  try {
    const res = await fetch(`/api/scenarios/${encodeURIComponent(city)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Failed to save scenario')
    }
    scenarioForm.reset()
    updateScenarioFieldVisibility()
    await loadScenarios()
    showSuccessToast(`Saved scenario for "${city}".`)
  } catch (err) {
    scenarioFormError.textContent = err.message
    scenarioFormError.hidden = false
  } finally {
    setLoading(scenarioSubmit, false, 'Save Scenario')
  }
})

function showSuccessToast(message) {
  clearTimeout(successToastTimer)
  scenarioFormSuccess.textContent = message
  scenarioFormSuccess.hidden = false
  successToastTimer = setTimeout(() => {
    scenarioFormSuccess.hidden = true
  }, 3000)
}

async function loadScenarios() {
  const res = await fetch('/api/scenarios')
  const scenarios = await res.json()
  renderScenarioTable(scenarios)
}

function renderScenarioTable(scenarios) {
  scenarioTableBody.textContent = ''
  scenarioEmptyState.hidden = scenarios.length > 0

  for (const scenario of scenarios) {
    const row = document.createElement('tr')
    row.className = 'scenario-row'
    row.tabIndex = 0
    row.addEventListener('click', () => selectScenario(scenario))
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        selectScenario(scenario)
      }
    })

    const cityCell = document.createElement('td')
    cityCell.textContent = scenario.city
    row.appendChild(cityCell)

    const codeCell = document.createElement('td')
    const pill = document.createElement('span')
    pill.className = `code-pill code-${scenario.responseCode}`
    pill.textContent = scenario.responseCode
    codeCell.appendChild(pill)
    row.appendChild(codeCell)

    const detailsCell = document.createElement('td')
    detailsCell.textContent = scenario.responseCode === 200
      ? `${scenario.cityName}, ${scenario.temperature}°F`
      : `code ${scenario.errorCode}: ${scenario.errorInfo}`
    row.appendChild(detailsCell)

    const actionCell = document.createElement('td')
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', async (event) => {
      event.stopPropagation()
      deleteBtn.disabled = true
      await fetch(`/api/scenarios/${encodeURIComponent(scenario.city)}`, { method: 'DELETE' })
      await loadScenarios()
    })
    actionCell.appendChild(deleteBtn)
    row.appendChild(actionCell)

    scenarioTableBody.appendChild(row)
  }
}

function selectScenario(scenario) {
  document.getElementById('scenario-city').value = scenario.city
  scenarioResponseCode.value = String(scenario.responseCode)
  updateScenarioFieldVisibility()

  if (scenario.responseCode === 200) {
    document.getElementById('scenario-city-name').value = scenario.cityName
    document.getElementById('scenario-temperature').value = scenario.temperature
    document.getElementById('scenario-error-code').value = ''
    document.getElementById('scenario-error-info').value = ''
  } else {
    document.getElementById('scenario-error-code').value = scenario.errorCode
    document.getElementById('scenario-error-info').value = scenario.errorInfo
    document.getElementById('scenario-city-name').value = ''
    document.getElementById('scenario-temperature').value = ''
  }

  scenarioFormError.hidden = true
  document.getElementById('scenario-city').focus()
}

document.getElementById('city-input').focus()
loadScenarios()
