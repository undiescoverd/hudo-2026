import type { RenderedEmail } from './erasure-confirmation'

export interface MemberRemovedReceiptData {
  ownerName: string
  agencyName: string
  removedName: string
  accountErased: boolean
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderMemberRemovedReceiptEmail({
  ownerName,
  agencyName,
  removedName,
  accountErased,
}: MemberRemovedReceiptData): RenderedEmail {
  const subject = `${removedName} was removed from ${agencyName}`
  const body = `${removedName} was removed from ${agencyName} and their videos in this agency were permanently deleted${
    accountErased ? '; they belong to no other agency, so their account was erased too' : ''
  }. This is a receipt for your records.`

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
  <h2 style="margin:0 0 12px;font-size:20px">${esc(subject)}</h2>
  <p style="margin:0 0 16px;color:#374151">Hi ${esc(ownerName)},</p>
  <p style="margin:0 0 16px;color:#374151">${esc(body)}</p>
</body>
</html>`

  return { subject, html, text: `Hi ${ownerName},\n\n${body}\n` }
}
