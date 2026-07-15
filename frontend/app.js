// --- Tab navigation -----------------------------------------------------

const tabButtons = document.querySelectorAll('.tab-button')
const pageSections = {
  rest: document.getElementById('page-rest'),
  email: document.getElementById('page-email'),
  aws: document.getElementById('page-aws'),
  snowflake: document.getElementById('page-snowflake')
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
    if (target === 'snowflake') activateSnowflakeTab()
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

// --- Snowflake person records -------------------------------------------
//
// Row state shape: { firstName, lastName, favoriteColor, original, isNew }
// `original` is the {firstName, lastName} the row was loaded with (used as
// the UPDATE/DELETE WHERE key so a rename doesn't lose the row) — null for
// a row added locally via "+" that's never been saved. `isNew` distinguishes
// "Save" meaning INSERT vs UPDATE, and "Delete" meaning "just drop it
// locally" vs an actual DELETE call.

const snowflakeSourceRadios = document.querySelectorAll('input[name="snowflake-source"]')
const snowflakeFilterForm = document.getElementById('snowflake-filter-form')
const snowflakeFilterInput = document.getElementById('snowflake-filter-input')
const snowflakeFilterSubmit = document.getElementById('snowflake-filter-submit')
const snowflakeFilterClear = document.getElementById('snowflake-filter-clear')
const snowflakeRefreshBtn = document.getElementById('snowflake-refresh')
const snowflakeAddRowBtn = document.getElementById('snowflake-add-row')
const snowflakeRemoveRowBtn = document.getElementById('snowflake-remove-row')
const snowflakePresetKungFuPandaBtn = document.getElementById('snowflake-preset-kungfupanda')
const snowflakePresetRandomizeBtn = document.getElementById('snowflake-preset-randomize')
const snowflakePresetSchlechteBtn = document.getElementById('snowflake-preset-schlechte')
const snowflakeStatus = document.getElementById('snowflake-status')
const snowflakeTableBody = document.getElementById('snowflake-table-body')
const snowflakeEmptyState = document.getElementById('snowflake-empty-state')

// Static, easily-edited value pools for the "Randomize" preset button.
// First names: SSA's top 10 boys' + top 10 girls' names for 2025
// (ssa.gov/oact/babynames). Last names: the 10 most common US surnames per
// the 2020 Census (census.gov/library/stories/2026/04/2020-census-names-data.html).
// Colors: not sourced from any dataset, just a reasonable common-colors list.
const SNOWFLAKE_RANDOM_FIRST_NAMES = [
  'Liam', 'Noah', 'Oliver', 'Theodore', 'Henry', 'James', 'Elijah', 'Mateo', 'William', 'Lucas',
  'Olivia', 'Charlotte', 'Emma', 'Amelia', 'Sophia', 'Mia', 'Isabella', 'Evelyn', 'Sofia', 'Eliana'
]
const SNOWFLAKE_RANDOM_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'
]
const SNOWFLAKE_RANDOM_COLORS = [
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Black', 'White', 'Gray',
  'Brown', 'Teal', 'Navy', 'Maroon', 'Turquoise', 'Violet', 'Indigo', 'Gold', 'Silver', 'Coral'
]

function randomSnowflakeValue(list) {
  return list[Math.floor(Math.random() * list.length)]
}

// Created once and moved (not cloned) into the selected row's own last
// column, rather than positioned as a floating toolbar outside the table —
// keeps them aligned with their row for free via normal table layout, and
// off-DOM (so never visible) whenever nothing is selected.
const snowflakeSaveRowBtn = document.createElement('button')
snowflakeSaveRowBtn.type = 'button'
snowflakeSaveRowBtn.className = 'icon-button'
snowflakeSaveRowBtn.title = 'Save row'
snowflakeSaveRowBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>'
snowflakeSaveRowBtn.addEventListener('click', () => saveSelectedSnowflakeRow())

const snowflakeDeleteRowBtn = document.createElement('button')
snowflakeDeleteRowBtn.type = 'button'
snowflakeDeleteRowBtn.className = 'icon-button'
snowflakeDeleteRowBtn.title = 'Delete row'
snowflakeDeleteRowBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>'
snowflakeDeleteRowBtn.addEventListener('click', () => deleteSelectedSnowflakeRow())

let snowflakeRecords = []
let snowflakeSelectedIndex = null
let snowflakeInitialized = false

function getSnowflakeSource() {
  return document.querySelector('input[name="snowflake-source"]:checked').value
}

async function fetchSnowflakeRecords(firstNameFilter) {
  const params = new URLSearchParams({ source: getSnowflakeSource() })
  if (firstNameFilter) params.set('firstName', firstNameFilter)
  const res = await fetch(`/api/snowflake/records?${params}`)
  return res.json()
}

// Guards against out-of-order responses: switching Source (or clicking
// Filter/Refresh/Clear again) before a prior request finishes starts a
// second, independent request with nothing cancelling the first. Without
// this, a slow-to-fail older request (e.g. the mock's 8s connect timeout)
// can resolve after a faster newer one and stomp its result — confirmed
// live: switching from Localstack to Snowflake (real) mid-request showed
// the real source's fast result, then had it overwritten seconds later by
// the mock's stale timeout error once that request finally settled.
let snowflakeRequestId = 0

async function loadSnowflakeRecords(firstNameFilter) {
  const requestId = ++snowflakeRequestId
  const previousRecords = snowflakeRecords
  snowflakeStatus.textContent = 'Loading…'
  try {
    const data = await fetchSnowflakeRecords(firstNameFilter)
    if (requestId !== snowflakeRequestId) return
    if (data.status !== 'success') throw new Error(data.errorInfo || 'Failed to load records.')
    const freshRecords = data.records.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      favoriteColor: r.favoriteColor,
      // Full snapshot as loaded — used both as the UPDATE/DELETE WHERE key
      // (firstName/lastName only) and, in full, to detect unsaved edits
      // (see isSnowflakeRowDirty) so a row with in-progress changes can be
      // called out once the user selects a different row.
      original: { firstName: r.firstName, lastName: r.lastName, favoriteColor: r.favoriteColor },
      isNew: false
    }))
    // Reloading (whether from Refresh/Filter/Clear/switching Source, or
    // automatically after saving/deleting a *different* row) otherwise
    // wholesale replaces snowflakeRecords with the server's response —
    // discarding any other row's unsaved edits or never-saved "+"/preset
    // rows in the process, even though nothing the user did targeted them.
    // Carrying dirty rows forward across the reload fixes that. Callers
    // that just persisted a row mark it clean first (see
    // saveSelectedSnowflakeRow/deleteSelectedSnowflakeRow) so it isn't
    // re-added here as a stale duplicate of the fresh copy above.
    const unsavedLocalRecords = previousRecords.filter(isSnowflakeRowDirty)
    snowflakeRecords = [...freshRecords, ...unsavedLocalRecords]
    snowflakeStatus.textContent = ''
  } catch (err) {
    if (requestId !== snowflakeRequestId) return
    // Drop previously-loaded clean rows — they're now an unconfirmed cache
    // of server state, and showing them post-failure would look like real
    // synced data when it might not be anymore — but keep dirty ones,
    // since those are legitimately client-only and not something this
    // failure has any bearing on.
    snowflakeRecords = previousRecords.filter(isSnowflakeRowDirty)
    snowflakeStatus.textContent = err.message
  }
  renderSnowflakeTable()
}

function renderSnowflakeTable() {
  // A full rebuild implicitly detaches the save/delete buttons along with
  // whatever row they were in — .remove() them explicitly too so their
  // state doesn't depend on that implicit side effect.
  snowflakeSaveRowBtn.remove()
  snowflakeDeleteRowBtn.remove()
  snowflakeSelectedIndex = null
  snowflakeRemoveRowBtn.disabled = true

  snowflakeTableBody.textContent = ''
  snowflakeEmptyState.hidden = snowflakeRecords.length > 0

  snowflakeRecords.forEach((record, index) => {
    const row = document.createElement('tr')
    row.className = 'snowflake-row'
    row.tabIndex = 0
    row.addEventListener('click', () => toggleSnowflakeRowSelection(index))
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggleSnowflakeRowSelection(index)
      }
    })

    for (const field of ['firstName', 'lastName', 'favoriteColor']) {
      const cell = document.createElement('td')
      cell.textContent = record[field]
      cell.addEventListener('dblclick', (event) => {
        event.stopPropagation()
        selectSnowflakeRow(index)
        startSnowflakeCellEdit(cell, index, field)
      })
      row.appendChild(cell)
    }

    const actionsCell = document.createElement('td')
    actionsCell.className = 'snowflake-actions-cell'
    row.appendChild(actionsCell)

    snowflakeTableBody.appendChild(row)
  })

  updateSnowflakeDirtyHighlights()
}

function isSnowflakeRowDirty(record) {
  if (record.isNew) return true
  return (
    record.firstName !== record.original.firstName ||
    record.lastName !== record.original.lastName ||
    record.favoriteColor !== record.original.favoriteColor
  )
}

// A row with unsaved edits (or a never-saved "+"/preset row) would be
// silently lost on the next Refresh/Filter/Clear/source switch. That only
// matters once it's *not* the selected row — while selected, the user is
// already looking right at it, mid-edit. Called on every selection change
// so the warning follows the user as they move between rows.
function updateSnowflakeDirtyHighlights() {
  for (const [i, row] of [...snowflakeTableBody.children].entries()) {
    row.classList.toggle('dirty', i !== snowflakeSelectedIndex && isSnowflakeRowDirty(snowflakeRecords[i]))
  }
}

function startSnowflakeCellEdit(cell, rowIndex, field) {
  if (cell.querySelector('input')) return
  const record = snowflakeRecords[rowIndex]
  const previousValue = record[field]

  const input = document.createElement('input')
  input.type = 'text'
  input.value = previousValue
  input.className = 'cell-edit-input'

  cell.textContent = ''
  cell.appendChild(input)
  input.focus()
  input.select()

  const commit = () => {
    record[field] = input.value.trim()
    cell.textContent = record[field]
  }

  input.addEventListener('blur', commit)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      input.removeEventListener('blur', commit)
      cell.textContent = previousValue
    }
  })
}

function toggleSnowflakeRowSelection(index) {
  if (snowflakeSelectedIndex === index) {
    clearSnowflakeSelection()
  } else {
    selectSnowflakeRow(index)
  }
}

function selectSnowflakeRow(index) {
  if (snowflakeRecords.length === 0) return
  snowflakeSaveRowBtn.remove()
  snowflakeDeleteRowBtn.remove()
  snowflakeSelectedIndex = index
  for (const [i, row] of [...snowflakeTableBody.children].entries()) {
    row.classList.toggle('selected', i === index)
  }
  snowflakeRemoveRowBtn.disabled = false
  const actionsCell = snowflakeTableBody.children[index].querySelector('.snowflake-actions-cell')
  actionsCell.appendChild(snowflakeSaveRowBtn)
  actionsCell.appendChild(snowflakeDeleteRowBtn)
  updateSnowflakeDirtyHighlights()
}

function clearSnowflakeSelection() {
  snowflakeSaveRowBtn.remove()
  snowflakeDeleteRowBtn.remove()
  snowflakeSelectedIndex = null
  for (const row of snowflakeTableBody.children) row.classList.remove('selected')
  snowflakeRemoveRowBtn.disabled = true
  updateSnowflakeDirtyHighlights()
}

// Shared by "+" and all preset buttons — only the initial field values
// differ. Matches "+"'s contract: a local-only row, selected but never
// sent to the server until the user clicks the save icon themselves.
function addSnowflakeRow(overrides = {}) {
  snowflakeRecords.push({ firstName: '', lastName: '', favoriteColor: '', ...overrides, original: null, isNew: true })
  renderSnowflakeTable()
  selectSnowflakeRow(snowflakeRecords.length - 1)
}

snowflakeAddRowBtn.addEventListener('click', () => addSnowflakeRow())

// Po (Kung Fu Panda) is voiced by Jack Black — first/last name spell out
// the actor's real name, favoriteColor picks up the panda's other color
// rather than repeating "Black".
snowflakePresetKungFuPandaBtn.addEventListener('click', () => {
  addSnowflakeRow({ firstName: 'Jack', lastName: 'Black', favoriteColor: 'White' })
})

snowflakePresetRandomizeBtn.addEventListener('click', () => {
  addSnowflakeRow({
    firstName: randomSnowflakeValue(SNOWFLAKE_RANDOM_FIRST_NAMES),
    lastName: randomSnowflakeValue(SNOWFLAKE_RANDOM_LAST_NAMES),
    favoriteColor: randomSnowflakeValue(SNOWFLAKE_RANDOM_COLORS)
  })
})

snowflakePresetSchlechteBtn.addEventListener('click', () => {
  addSnowflakeRow({ firstName: 'No', lastName: 'Way' })
})

async function deleteSelectedSnowflakeRow() {
  if (snowflakeSelectedIndex === null) return
  const record = snowflakeRecords[snowflakeSelectedIndex]

  if (record.isNew) {
    snowflakeRecords.splice(snowflakeSelectedIndex, 1)
    renderSnowflakeTable()
    return
  }

  snowflakeStatus.textContent = 'Deleting…'
  try {
    const params = new URLSearchParams({
      source: getSnowflakeSource(),
      firstName: record.original.firstName,
      lastName: record.original.lastName
    })
    const res = await fetch(`/api/snowflake/records?${params}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.status !== 'success') throw new Error(data.errorInfo || 'Failed to delete record.')
    // Remove it locally before reloading — otherwise, if it happened to be
    // "dirty" (edited before being deleted), loadSnowflakeRecords' merge
    // would carry it right back in as a stale local row.
    snowflakeRecords.splice(snowflakeSelectedIndex, 1)
    await loadSnowflakeRecords()
  } catch (err) {
    snowflakeStatus.textContent = err.message
  }
}

async function saveSelectedSnowflakeRow() {
  if (snowflakeSelectedIndex === null) return
  const record = snowflakeRecords[snowflakeSelectedIndex]

  if (!record.firstName || !record.lastName || !record.favoriteColor) {
    snowflakeStatus.textContent = 'First name, last name, and favorite color are all required.'
    return
  }

  snowflakeStatus.textContent = 'Saving…'
  const source = getSnowflakeSource()

  try {
    const res = record.isNew
      ? await fetch('/api/snowflake/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            firstName: record.firstName,
            lastName: record.lastName,
            favoriteColor: record.favoriteColor
          })
        })
      : await fetch('/api/snowflake/records', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source,
            oldFirstName: record.original.firstName,
            oldLastName: record.original.lastName,
            firstName: record.firstName,
            lastName: record.lastName,
            favoriteColor: record.favoriteColor
          })
        })
    const data = await res.json()
    if (data.status !== 'success') throw new Error(data.errorInfo || 'Failed to save record.')
    // Mark it clean before reloading — the fresh fetch's copy of this same
    // row is now the source of truth, and loadSnowflakeRecords' merge only
    // needs to preserve rows still genuinely unsaved.
    record.original = { firstName: record.firstName, lastName: record.lastName, favoriteColor: record.favoriteColor }
    record.isNew = false
    await loadSnowflakeRecords()
  } catch (err) {
    snowflakeStatus.textContent = err.message
  }
}

snowflakeRemoveRowBtn.addEventListener('click', deleteSelectedSnowflakeRow)

snowflakeFilterForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const value = snowflakeFilterInput.value.trim()
  setLoading(snowflakeFilterSubmit, true, 'Filtering…')
  await loadSnowflakeRecords(value || undefined)
  setLoading(snowflakeFilterSubmit, false, 'Filter')
})

snowflakeFilterClear.addEventListener('click', async () => {
  snowflakeFilterInput.value = ''
  snowflakeFilterClear.disabled = true
  await loadSnowflakeRecords()
  snowflakeFilterClear.disabled = false
})

snowflakeRefreshBtn.addEventListener('click', async () => {
  snowflakeRefreshBtn.disabled = true
  await loadSnowflakeRecords()
  snowflakeRefreshBtn.disabled = false
})

for (const radio of snowflakeSourceRadios) {
  radio.addEventListener('change', () => {
    snowflakeFilterInput.value = ''
    loadSnowflakeRecords()
  })
}

function activateSnowflakeTab() {
  if (!snowflakeInitialized) {
    snowflakeInitialized = true
    loadSnowflakeRecords()
  }
}
