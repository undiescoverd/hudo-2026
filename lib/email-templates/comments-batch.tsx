export interface CommentEntry {
  authorName: string
  content: string
  timestampSeconds?: number
}

export interface VideoGroup {
  title: string
  videoUrl: string
  comments: CommentEntry[]
}

export interface CommentsBatchEmailData {
  recipientName: string
  videos: VideoGroup[]
}

function formatTs(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderCommentsBatchEmail({
  recipientName,
  videos,
}: CommentsBatchEmailData): string {
  const total = videos.reduce((n, v) => n + v.comments.length, 0)

  const videoBlocks = videos
    .map(
      (v) => `
    <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #e5e7eb">
      <h3 style="margin:0 0 4px;font-size:16px;font-weight:600">
        <a href="${esc(v.videoUrl)}" style="color:#111827;text-decoration:none">${esc(v.title)}</a>
      </h3>
      <p style="margin:0 0 12px;font-size:13px;color:#6b7280">
        ${v.comments.length} new comment${v.comments.length !== 1 ? 's' : ''}
      </p>
      ${v.comments
        .map(
          (c) => `
        <div style="background:#f9fafb;border-radius:6px;padding:10px 12px;margin-bottom:8px">
          <span style="font-weight:600;font-size:13px">${esc(c.authorName)}</span>
          ${
            c.timestampSeconds != null
              ? `<span style="color:#9ca3af;font-size:11px;margin-left:8px">at ${formatTs(c.timestampSeconds)}</span>`
              : ''
          }
          <p style="margin:4px 0 0;font-size:14px;color:#374151">${esc(c.content)}</p>
        </div>`
        )
        .join('')}
      <a href="${esc(v.videoUrl)}" style="font-size:13px;color:#4f46e5">View and reply →</a>
    </div>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
  <h2 style="margin:0 0 4px;font-size:20px">You have ${total} new comment${total !== 1 ? 's' : ''}</h2>
  <p style="margin:0 0 24px;color:#6b7280">Hi ${esc(recipientName)},</p>
  ${videoBlocks}
  <p style="font-size:12px;color:#9ca3af">
    Manage notification preferences in your Hudo account settings.
  </p>
</body>
</html>`
}
