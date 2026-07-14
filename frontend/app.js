// --- Tab navigation -----------------------------------------------------

const tabButtons = document.querySelectorAll('.tab-button')
const pageSections = {
  rest: document.getElementById('page-rest'),
  email: document.getElementById('page-email'),
  aws: document.getElementById('page-aws')
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    const target = button.dataset.page
    for (const b of tabButtons) {
      const isActive = b === button
      b.classList.toggle('active', isActive)
      b.setAttribute('aria-selected', String(isActive))
    }
    for (const [name, section] of Object.entries(pageSections)) {
      section.hidden = name !== target
    }
  })
}

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

// --- Email sending --------------------------------------------------------

const emailForm = document.getElementById('email-form')
const emailResult = document.getElementById('email-result')
const emailSubmit = document.getElementById('email-submit')
const inboxRefreshBtn = document.getElementById('inbox-refresh')
const inboxStatus = document.getElementById('inbox-status')
const inboxEmpty = document.getElementById('inbox-empty')
const inboxMessage = document.getElementById('inbox-message')

emailForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const to = document.getElementById('email-to').value.trim()
  const body = document.getElementById('email-body').value
  const provider = emailForm.querySelector('input[name="provider"]:checked').value
  if (!to) return

  emailResult.hidden = true
  setLoading(emailSubmit, true, 'Sending…')

  try {
    const res = await fetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, body, provider })
    })
    const data = await res.json()
    renderEmailResult(data)

    if (data.status === 'success' && provider === 'mokapi') {
      await pollMokapiInbox(to)
    }
  } catch (err) {
    renderEmailResult({ status: 'error', errorInfo: `Request failed: ${err.message}` })
  } finally {
    setLoading(emailSubmit, false, 'Send')
  }
})

function renderEmailResult(data) {
  emailResult.hidden = false
  emailResult.style.animation = 'none'
  void emailResult.offsetWidth
  emailResult.style.animation = ''

  if (data.status === 'success') {
    emailResult.className = 'result success'
    emailResult.textContent = `Sent via ${data.provider === 'google' ? 'Google SMTP' : "mokapi's mock SMTP server"} to ${data.to}.`
  } else {
    emailResult.className = 'result error'
    emailResult.textContent = data.errorInfo || 'Failed to send email.'
  }
}

async function pollMokapiInbox(address) {
  inboxStatus.textContent = 'Checking mokapi inbox…'
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await checkMokapiInbox(address)
    if (found) {
      inboxStatus.textContent = ''
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  inboxStatus.textContent = 'Not captured yet — try Refresh in a moment.'
}

async function checkMokapiInbox(address) {
  const res = await fetch(`/api/email/mokapi-inbox/${encodeURIComponent(address)}`)
  const data = await res.json()

  if (data.status === 'found') {
    inboxEmpty.hidden = true
    inboxMessage.hidden = false
    inboxMessage.textContent = `Subject: ${data.message.subject}\nFrom: ${data.message.from}\nTo: ${data.message.to}\n\n${data.message.body}`
    return true
  }

  if (data.status === 'error') {
    inboxStatus.textContent = data.errorInfo
  }
  return false
}

inboxRefreshBtn.addEventListener('click', async () => {
  const address = document.getElementById('email-to').value.trim()
  if (!address) {
    inboxStatus.textContent = 'Enter a "To" address first.'
    return
  }
  inboxRefreshBtn.disabled = true
  inboxStatus.textContent = 'Checking mokapi inbox…'
  const found = await checkMokapiInbox(address)
  inboxStatus.textContent = found ? '' : 'No message captured yet for this address.'
  inboxRefreshBtn.disabled = false
})

// --- AWS SQS sending --------------------------------------------------

const awsForm = document.getElementById('aws-form')
const awsResult = document.getElementById('aws-result')
const awsSubmit = document.getElementById('aws-submit')
const awsQueueRefreshBtn = document.getElementById('aws-queue-refresh')
const awsQueueStatus = document.getElementById('aws-queue-status')
const awsQueueEmpty = document.getElementById('aws-queue-empty')
const awsQueueMessage = document.getElementById('aws-queue-message')

awsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const body = document.getElementById('aws-body').value
  const source = awsForm.querySelector('input[name="source"]:checked').value
  if (!body.trim()) return

  awsResult.hidden = true
  setLoading(awsSubmit, true, 'Sending…')

  try {
    const res = await fetch('/api/aws/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, source })
    })
    const data = await res.json()
    renderAwsResult(data)

    if (data.status === 'success' && source === 'localstack') {
      await pollLocalstackQueue()
    }
  } catch (err) {
    renderAwsResult({ status: 'error', errorInfo: `Request failed: ${err.message}` })
  } finally {
    setLoading(awsSubmit, false, 'Send')
  }
})

function renderAwsResult(data) {
  awsResult.hidden = false
  awsResult.style.animation = 'none'
  void awsResult.offsetWidth
  awsResult.style.animation = ''

  if (data.status === 'success') {
    awsResult.className = 'result success'
    awsResult.textContent = `Sent via ${data.source === 'aws' ? 'real AWS SQS' : "localstack's mock SQS queue"}.`
  } else {
    awsResult.className = 'result error'
    awsResult.textContent = data.errorInfo || 'Failed to send message.'
  }
}

async function pollLocalstackQueue() {
  awsQueueStatus.textContent = 'Checking localstack queue…'
  for (let attempt = 0; attempt < 5; attempt++) {
    const data = await refreshLocalstackQueue()
    if (data.status === 'error') {
      awsQueueStatus.textContent = data.errorInfo
      return
    }
    if (data.receivedNew) {
      awsQueueStatus.textContent = ''
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  awsQueueStatus.textContent = 'Not captured yet — try Refresh in a moment.'
}

// Reading a message from the localstack queue is destructive (matches a
// real consumer), so the queue itself can't be "re-checked" for history —
// the backend keeps its own short buffer of recently consumed messages
// (see fetchLocalstackMessages in sqsClient.js) and returns the whole
// thing every time, newest first, which is what's rendered here.
async function refreshLocalstackQueue() {
  const res = await fetch('/api/aws/localstack-inbox')
  const data = await res.json()

  if (data.status === 'found') {
    awsQueueEmpty.hidden = true
    awsQueueMessage.hidden = false
    awsQueueMessage.textContent = data.messages
      .map((m) => `Message ID: ${m.messageId}\n\n${m.body}`)
      .join(`\n\n${'─'.repeat(40)}\n\n`)
  }

  return data
}

awsQueueRefreshBtn.addEventListener('click', async () => {
  awsQueueRefreshBtn.disabled = true
  awsQueueStatus.textContent = 'Checking localstack queue…'
  const data = await refreshLocalstackQueue()
  awsQueueStatus.textContent = data.status === 'found' ? '' : (data.errorInfo || 'No message captured yet.')
  awsQueueRefreshBtn.disabled = false
})
