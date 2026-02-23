import { Resend } from 'resend'

/**
 * Resend client for transactional email.
 * Used for: invitation emails, password reset, notifications.
 * Not used for marketing — only system-triggered messages.
 */
export const resend = new Resend(process.env.RESEND_API_KEY || '')

/**
 * Default "from" address for all outbound email.
 * Falls back to Resend test address for local development.
 */
export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev'

interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

/**
 * Send a transactional email via Resend.
 * Returns the Resend message ID on success, or throws on failure.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams) {
  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(text ? { text } : {}),
  })

  if (error) {
    throw new Error(`Resend error: ${error.message}`)
  }

  return data
}
