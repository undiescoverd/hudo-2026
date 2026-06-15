/**
 * lib/pdf-export.ts
 *
 * PDF generation for comment exports. Pure functions — no Supabase, no Next.js
 * imports, fully testable in isolation.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentRow {
  id: string
  timestamp_seconds: number | null
  commenter_name: string
  content: string
  resolved: boolean
}

export interface ExportInput {
  videoTitle: string
  versionNumber: number
  exportDate: Date
  generatorName: string
  comments: CommentRow[]
}

// ---------------------------------------------------------------------------
// Auth helper (pure — no I/O)
// ---------------------------------------------------------------------------

export function canExport({
  role,
  videoTalentId,
  userId,
}: {
  role: string
  videoTalentId: string
  userId: string
}): boolean {
  if (role === 'talent') return videoTalentId === userId
  // owner | admin_agent | agent
  return ['owner', 'admin_agent', 'agent'].includes(role)
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strip characters outside WinAnsi (Helvetica encoding). Replaces them with '?'. */
function sanitiseText(s: string): string {
  // Keep printable ASCII (0x20–0x7E) and common WinAnsi extended (0x80–0xFF).
  // For simplicity, replace anything above 0xFF with '?'.
  return s.replace(/[^\x20-\xFF]/g, '?')
}

/** Word-wrap a line into chunks of at most `maxWidth` chars (rough char-based). */
function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars) {
      if (current) lines.push(current)
      // If a single word exceeds maxChars, hard-break it
      if (word.length > maxChars) {
        for (let i = 0; i < word.length; i += maxChars) {
          lines.push(word.slice(i, i + maxChars))
        }
        current = ''
      } else {
        current = word
      }
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

const PAGE_MARGIN = 50
const PAGE_WIDTH = 595 // A4
const PAGE_HEIGHT = 842 // A4
const USABLE_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2
const LINE_HEIGHT = 14
const SECTION_GAP = 6

/**
 * Generates a PDF comment export. Returns the raw bytes as a Uint8Array.
 * The first four bytes will be `%PDF` (0x25 0x50 0x44 0x46).
 */
export async function buildCommentExportPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const dateStr = input.exportDate.toISOString().slice(0, 10)
  const title = sanitiseText(input.videoTitle)
  const generator = sanitiseText(input.generatorName)

  // State for current page
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - PAGE_MARGIN

  /** Ensure we have at least `needed` vertical space; add new page if not. */
  function ensureSpace(needed: number) {
    if (y - needed < PAGE_MARGIN) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      y = PAGE_HEIGHT - PAGE_MARGIN
    }
  }

  function drawText(text: string, x: number, size: number, isBold = false) {
    const font = isBold ? bold : regular
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })
    y -= LINE_HEIGHT
  }

  // ---- Header ----
  drawText(`Comment Export — ${title}`, PAGE_MARGIN, 16, true)
  drawText(`Version: ${input.versionNumber}`, PAGE_MARGIN, 11)
  drawText(`Export date: ${dateStr}`, PAGE_MARGIN, 11)
  drawText(`Exported by: ${generator}`, PAGE_MARGIN, 11)
  y -= SECTION_GAP

  // Horizontal rule
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  })
  y -= LINE_HEIGHT

  if (input.comments.length === 0) {
    ensureSpace(LINE_HEIGHT * 2)
    drawText('No comments.', PAGE_MARGIN, 11)
  } else {
    for (const c of input.comments) {
      // Each comment block: need at least header row + 2 body rows
      ensureSpace(LINE_HEIGHT * 3)

      const ts =
        c.timestamp_seconds !== null && c.timestamp_seconds !== undefined
          ? formatTimestamp(c.timestamp_seconds)
          : '—'

      const status = c.resolved ? '[Resolved]' : '[Open]'
      const commenter = sanitiseText(c.commenter_name)
      const header = sanitiseText(`${ts}  ${commenter}  ${status}`)
      drawText(header, PAGE_MARGIN, 10, true)

      const bodyLines = wrapLine(sanitiseText(c.content), Math.floor(USABLE_WIDTH / 6.5))
      for (const line of bodyLines) {
        ensureSpace(LINE_HEIGHT)
        drawText(line, PAGE_MARGIN + 12, 10)
      }

      y -= SECTION_GAP
    }
  }

  const bytes = await doc.save()
  return bytes
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(seconds: number): string {
  const totalSecs = Math.floor(seconds)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
