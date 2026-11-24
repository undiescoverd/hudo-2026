/**
 * UploadProgress / upload page — source invariants (repo pattern: node:test + fs).
 *
 * Run: npx tsx --test "components/upload/UploadProgress.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('UploadProgress — quota panel (B3)', () => {
  let source: string
  before(() => {
    source = fs.readFileSync(path.resolve(here, 'UploadProgress.tsx'), 'utf8')
  })

  it('uses isQuotaMessage, not a loose substring match', () => {
    assert.match(source, /isQuotaMessage\(error\)/)
    assert.doesNotMatch(source, /includes\(['"]quota['"]\)/)
  })

  it('renders non-quota errors in the normal row with a Retry button', () => {
    assert.match(source, /onClick=\{onRetry\}/)
  })
})

describe('upload page — wiring (B1/B2)', () => {
  let source: string
  before(() => {
    source = fs.readFileSync(path.resolve(here, '../../app/(dashboard)/upload/page.tsx'), 'utf8')
  })

  it('uses the extracted upload client and keeps no inline presign', () => {
    assert.match(source, /from '@\/lib\/upload-client'/)
    assert.doesNotMatch(source, /upload\/presign/)
  })

  it('holds the first presign videoId in a ref and clears it on "Choose different file"', () => {
    assert.match(source, /draftVideoIdRef/)
    assert.equal(
      (source.match(/draftVideoIdRef\.current = targetVideoId/g) ?? []).length >= 2,
      true
    )
  })

  it('never sends a talentId or shows a talent picker (agents never upload, S5-NAV-006)', () => {
    assert.doesNotMatch(source, /talentId|needsTalent|Invite a talent/)
  })
})
