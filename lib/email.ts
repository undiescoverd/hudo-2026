import { Resend } from 'resend'

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev'

interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailParams) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('[email] RESEND_API_KEY not configured')

  const resend = new Resend(apiKey)
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
