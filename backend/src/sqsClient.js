import {
    SQSClient,
    GetQueueUrlCommand,
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand
} from '@aws-sdk/client-sqs'

const QUEUE_NAME = process.env.SQS_QUEUE_NAME || 'mokapi-demo-queue'

// Container-internal address of localstack's edge port (see docker-compose.yml).
// Unaffected by LOCALSTACK_PORT, which only controls the host-side mapping —
// same pattern as MOKAPI_MAIL_SMTP_HOST/PORT in emailClient.js.
const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_SQS_ENDPOINT || 'http://localstack:4566'
const LOCALSTACK_REGION = process.env.LOCALSTACK_REGION || 'us-east-1'

// localstack doesn't validate credentials but the SDK v3 client still
// requires *some* static value — 'test'/'test' is localstack's own
// documented convention (account ID always resolves to 000000000000).
// Deliberately NOT using the default credential chain here, so real AWS
// creds (if present in the container env) can never leak into a localstack
// call, and vice versa.
let _localstackClient = null
function localstackClient() {
    if (!_localstackClient) {
        _localstackClient = new SQSClient({
            endpoint: LOCALSTACK_ENDPOINT,
            region: LOCALSTACK_REGION,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
        })
    }
    return _localstackClient
}

// Real AWS: no explicit credentials/region — the SDK v3 default provider
// chain resolves both from whatever docker-compose passes into the
// container environment (see .env.example). Deliberately no upfront
// AWS_ACCESS_KEY_ID presence check (unlike emailClient.js's Gmail check) —
// a legitimate deployment might supply credentials via a provider this
// backend can't see directly (IAM role, mounted ~/.aws, SSO cache), so a
// presence check would produce false negatives. The SDK's own credentials
// error surfaces through err.message in the route's catch block instead.
let _awsClient = null
function awsClient() {
    if (!_awsClient) _awsClient = new SQSClient({})
    return _awsClient
}

// SDK version differences mean the "queue not found" error can surface
// under any of these names — see CLAUDE.md's "AWS SQS mocking facts" for
// which one this was actually verified against.
const NON_EXISTENT_QUEUE_ERRORS = new Set([
    'QueueDoesNotExist',
    'QueueDoesNotExistException',
    'AWS.SimpleQueueService.NonExistentQueue'
])

// Neither source ever creates a queue — provisioning it is an infra concern,
// not something this integration layer does as a side effect of a request.
// For localstack, docker-compose's one-shot `localstack-init` service
// creates it on `docker compose up`; for real AWS, it's provisioned
// out-of-band (see README's "Provisioning the real SQS queue"). Resolved
// once per process and cached — queue identity doesn't change at runtime.
const queueUrlCache = new Map()

async function resolveQueueUrl(client, cacheKey, notFoundMessage) {
    if (queueUrlCache.has(cacheKey)) return queueUrlCache.get(cacheKey)
    try {
        const { QueueUrl } = await client().send(new GetQueueUrlCommand({ QueueName: QUEUE_NAME }))
        queueUrlCache.set(cacheKey, QueueUrl)
        return QueueUrl
    } catch (err) {
        if (NON_EXISTENT_QUEUE_ERRORS.has(err.name)) throw new Error(notFoundMessage)
        throw err
    }
}

function resolveLocalstackQueueUrl() {
    return resolveQueueUrl(
        localstackClient,
        'localstack',
        `SQS queue "${QUEUE_NAME}" does not exist in localstack. It should have been created by the ` +
        `"localstack-init" service on \`docker compose up\` — check \`docker compose logs localstack-init\`.`
    )
}

function resolveAwsQueueUrl() {
    return resolveQueueUrl(
        awsClient,
        'aws',
        `SQS queue "${QUEUE_NAME}" does not exist in the target AWS account/region. ` +
        `This demo never creates a real queue for you — provision it out-of-band, or use the Localstack source instead.`
    )
}

export async function sendMessage(source, body) {
    const client = source === 'aws' ? awsClient : localstackClient
    const QueueUrl = await (source === 'aws' ? resolveAwsQueueUrl() : resolveLocalstackQueueUrl())
    await client().send(new SendMessageCommand({ QueueUrl, MessageBody: body }))
}

// Destructive read: ReceiveMessage + DeleteMessage, matching how a real SQS
// consumer works — once shown, a message is gone from the queue for good.
// Because of that, the queue itself can't be used as the source of "recent
// history" (there's nothing left to re-read), so the last MAX_HISTORY
// consumed messages are kept in this in-memory buffer instead, newest
// first. This resets whenever the backend process restarts — no database,
// matching the rest of this repo's "flat file / in-memory, not a database"
// philosophy — which is fine for a demo (see README).
const MAX_HISTORY = 5
let localstackMessageHistory = []

export async function fetchLocalstackMessages() {
    const QueueUrl = await resolveLocalstackQueueUrl()
    const { Messages } = await localstackClient().send(new ReceiveMessageCommand({
        QueueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0
    }))

    let receivedNew = false
    if (Messages && Messages.length > 0) {
        const message = Messages[0]
        await localstackClient().send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }))
        localstackMessageHistory.unshift({ body: message.Body, messageId: message.MessageId })
        localstackMessageHistory.length = Math.min(localstackMessageHistory.length, MAX_HISTORY)
        receivedNew = true
    }

    return { messages: localstackMessageHistory, receivedNew }
}
