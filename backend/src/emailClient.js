import nodemailer from 'nodemailer'

// Container-internal address of mokapi's mock SMTP server (see mokapi/mail.yaml).
// Unaffected by MOKAPI_SMTP_PORT, which only controls the host-side mapping.
const MOKAPI_SMTP_HOST = process.env.MOKAPI_MAIL_SMTP_HOST || 'mokapi'
const MOKAPI_SMTP_PORT = Number(process.env.MOKAPI_MAIL_SMTP_PORT || 2525)
const MOKAPI_MAIL_API_URL = process.env.MOKAPI_MAIL_API_URL || 'http://mokapi:8080'
// Must match `info.title` in mokapi/mail.yaml — mokapi's mail REST API is
// namespaced by service title, not by file name.
const MOKAPI_MAIL_SERVICE_TITLE = process.env.MOKAPI_MAIL_SERVICE_TITLE || 'Mokapi Email Demo'

const DEMO_SUBJECT = 'Message from Mokapi Email Demo'
const DEMO_SENDER = '"Mokapi Email Demo" <noreply@mokapi-demo.local>'

function mokapiTransport() {
    return nodemailer.createTransport({
        host: MOKAPI_SMTP_HOST,
        port: MOKAPI_SMTP_PORT,
        secure: false,
        tls: { rejectUnauthorized: false }
    })
}

function googleTransport() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    })
}

export async function sendEmail(provider, to, body) {
    if (provider === 'google') {
        if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
            throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env to send via Google')
        }
        await googleTransport().sendMail({ from: process.env.GMAIL_USER, to, subject: DEMO_SUBJECT, text: body })
        return
    }

    await mokapiTransport().sendMail({ from: DEMO_SENDER, to, subject: DEMO_SUBJECT, text: body })
}

// Two-step lookup against mokapi's mail REST API: list messages for the
// recipient mailbox, then fetch the full body of the most recent one.
// Returns null if mokapi hasn't captured anything for this address yet.
export async function fetchMokapiInboxMessage(address) {
    const listUrl = `${MOKAPI_MAIL_API_URL}/api/services/mail/${encodeURIComponent(MOKAPI_MAIL_SERVICE_TITLE)}/mailboxes/${encodeURIComponent(address)}/messages?limit=1`
    const listRes = await fetch(listUrl)
    if (!listRes.ok) return null
    const messages = await listRes.json()
    if (!Array.isArray(messages) || messages.length === 0) return null

    const summary = messages[0]
    const detailRes = await fetch(`${MOKAPI_MAIL_API_URL}/api/services/mail/messages/${encodeURIComponent(summary.messageId)}`)
    if (!detailRes.ok) return null
    const detail = await detailRes.json()

    return {
        subject: summary.subject,
        from: summary.from?.[0]?.address ?? '',
        to: summary.to?.[0]?.address ?? '',
        body: detail.data?.body ?? ''
    }
}
