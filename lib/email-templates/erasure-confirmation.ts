export interface ErasureConfirmationData {
  recipientName: string
  /** Set when the person was removed from one agency but kept their account. */
  agencyName?: string | null
  /** True when the whole account was erased. */
  accountErased: boolean
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderErasureConfirmationEmail({
  recipientName,
  agencyName,
  accountErased,
}: ErasureConfirmationData): RenderedEmail {
  const where = agencyName ? ` from ${agencyName}` : ''
  const subject = accountErased
    ? 'Your Hudo account and data have been erased'
    : `Your videos${where} have been deleted`
  const body = accountErased
    ? 'Your Hudo account has been erased and the videos you were the talent on have been permanently deleted. Comments you wrote on other people’s videos remain, shown as “Deleted User”.'
    : `You have been removed${where} and the videos you were the talent on there have been permanently deleted. Your account and any other agencies you belong to are unchanged.`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
  <h2 style="margin:0 0 12px;font-size:20px">${esc(subject)}</h2>
  <p style="margin:0 0 16px;color:#374151">Hi ${esc(recipientName)},</p>
  <p style="margin:0 0 16px;color:#374151">${esc(body)}</p>
  <p style="font-size:12px;color:#9ca3af">This is a confirmation for your records. Deletion cannot be undone.</p>
</body>
</html>`

  return { subject, html, text: `Hi ${recipientName},\n\n${body}\n` }
}
