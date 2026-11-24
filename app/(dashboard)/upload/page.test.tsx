/**
 * Source-invariant tests for the upload page's "new version" mode
 * (/upload?videoId=<id>). Run: npx tsx --test "app/(dashboard)/upload/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('UploadPage — new version mode', () => {
  let source: string

  before(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(dir, 'page.tsx'), 'utf8')
  })

  it('reads videoId from the searchParams prop (no useSearchParams)', () => {
    assert.match(source, /parseTargetVideoId\(searchParams\?\.videoId\)/)
    assert.doesNotMatch(source, /useSearchParams/)
  })

  it('only exports the default component (Next.js page export rules)', () => {
    assert.equal([...source.matchAll(/^export /gm)].length, 1)
    assert.match(source, /export default function UploadPage/)
  })

  it('loads the video title read-only via an RLS-scoped lookup and uses its agency', () => {
    assert.match(
      source,
      /\.from\('videos'\)\s*\.select\('title, agency_id'\)\s*\.eq\('id', targetVideoId\)/
    )
    assert.match(source, /resolvedAgencyId = video\.agency_id/)
    assert.match(source, /Upload new version/)
    assert.match(source, /of “\{targetTitle\}”/)
  })

  it('stops with a setup error (not ready) when the target video lookup misses', () => {
    assert.match(source, /if \(!video\?\.agency_id\) \{\s*setSetupError\(/)
    assert.match(source, /if \(videoError\) throw new Error\('Failed to load video'\)/)
  })

  it('has no talent picker, roster or talentId (agents never upload, S5-NAV-006)', () => {
    assert.doesNotMatch(source, /talent-roster|fetchTalentRoster|isAgentClassRole/)
    assert.doesNotMatch(source, /upload-talent|Invite a talent|talentId|needsTalent/)
  })

  it("resolves the agency from the caller's talent membership, not whichever row is first", () => {
    assert.match(source, /\.eq\('role', 'talent'\)/)
  })

  it('seeds and resets the draft video id to the target so no new video is created', () => {
    assert.match(source, /useRef<string \| undefined>\(targetVideoId\)/)
    assert.doesNotMatch(source, /draftVideoIdRef\.current = undefined/)
    // two reset handlers + the effect that follows URL changes
    assert.equal([...source.matchAll(/draftVideoIdRef\.current = targetVideoId/g)].length, 3)
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*draftVideoIdRef\.current = targetVideoId\s*\}, \[targetVideoId\]\)/
    )
  })

  it('redirects to /videos/<id> on success and skips MetadataForm in version mode', () => {
    assert.match(
      source,
      /if \(targetVideoId\) \{\s*router\.push\(`\/videos\/\$\{targetVideoId\}`\)\s*return\s*\}/
    )
  })

  it('keeps the Retry path using the same runUpload', () => {
    assert.match(source, /onRetry=\{handleRetry\}/)
    assert.match(source, /await runUpload\(file\)/)
  })

  it('warns before closing the tab while uploading', () => {
    assert.match(source, /if \(!uploading\) return/)
    // Guard behaviour is tested in lib/upload-client.retry.test.ts (attachBeforeUnloadGuard).
    assert.match(source, /return attachBeforeUnloadGuard\(window\)/)
  })
})
