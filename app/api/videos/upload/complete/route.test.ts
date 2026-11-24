/**
 * Unit tests for the upload complete API route.
 *
 * Tests validation logic, access control, and source code invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/upload/complete/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// Role authorization (agents rejected, mixed roles) is covered behaviourally in
// route.behavior.test.ts (S5-NAV-006).

describe('complete route — talent self-upload (S4-UPLOAD-001)', () => {
  it('UPLOAD_ROLES (real import) includes talent', async () => {
    const { UPLOAD_ROLES } = await import('../../../../../lib/api-helpers')
    assert.ok((UPLOAD_ROLES as readonly string[]).includes('talent'))
  })

  // Replicates the ownership guard: talent completing a video they don't own → 403.
  function talentOwnershipBlocked(role: string, videoTalentId: string, userId: string): boolean {
    return role === 'talent' && videoTalentId !== userId
  }

  it('blocks talent from completing an upload on a video they do not own', () => {
    assert.equal(talentOwnershipBlocked('talent', 'other-user', 'user-1'), true)
  })

  it('allows talent to complete an upload on their own video', () => {
    assert.equal(talentOwnershipBlocked('talent', 'user-1', 'user-1'), false)
  })

  // Real helper (lib/video-status.ts); the route's behaviour is covered end to end in
  // route.behavior.test.ts.
  it('flips for talent on draft, changes_requested and approved (S5-FLOW-003)', async () => {
    const { shouldFlipOnTalentUpload } = await import('../../../../../lib/video-status')
    for (const status of ['draft', 'changes_requested', 'approved'])
      assert.equal(shouldFlipOnTalentUpload(status), true, status)
  })

  it('never flips for talent on pending_review or in_review, nor on an unknown status', async () => {
    const { shouldFlipOnTalentUpload } = await import('../../../../../lib/video-status')
    for (const status of ['pending_review', 'in_review', 'bogus', null])
      assert.equal(shouldFlipOnTalentUpload(status), false, String(status))
  })

  it('canTransition is unchanged: talent still cannot re-open Approved via PATCH', async () => {
    const { canTransition } = await import('../../../../../lib/video-status')
    assert.equal(canTransition('approved', 'pending_review', 'talent'), false)
  })
})

describe('complete route — multipart validation', () => {
  it('requires ETag (string) and PartNumber (number) for multipart parts', () => {
    const validPart = { ETag: '"abc123"', PartNumber: 1 }
    assert.equal(typeof validPart.ETag, 'string')
    assert.equal(typeof validPart.PartNumber, 'number')

    const invalidPart = { ETag: 123, PartNumber: 'one' }
    assert.notEqual(typeof invalidPart.ETag, 'string')
    assert.notEqual(typeof invalidPart.PartNumber, 'number')
  })

  it('rejects empty parts array when multipart flag is true', () => {
    const multipart = true
    const parts: unknown[] = []
    const valid = !multipart || (Array.isArray(parts) && parts.length > 0)
    assert.equal(valid, false)
  })

  it('accepts non-empty parts array when multipart flag is true', () => {
    const multipart = true
    const parts = [{ ETag: '"abc"', PartNumber: 1 }]
    const valid = !multipart || (Array.isArray(parts) && parts.length > 0)
    assert.equal(valid, true)
  })
})

describe('complete route — source invariants', () => {
  // Source invariant checks verify critical patterns exist. Full behavior
  // tests require Next.js runtime, Supabase, and R2 — these guards catch
  // accidental removal of auth, quota enforcement, and upload verification.
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('uses user-scoped Supabase client for RPC call (not service role)', () => {
    assert.match(source, /supabase\.rpc\('create_video_version'/)
    assert.doesNotMatch(source, /admin\.rpc\('create_video_version'/)
  })

  it('calls headObject to verify upload before creating version', () => {
    assert.match(source, /headObject/)
  })

  it('passes p_uploaded_by as user.id to the RPC', () => {
    assert.match(source, /p_uploaded_by:\s*user\.id/)
  })

  it('calls increment_storage_usage before create_video_version', () => {
    const incrementPos = source.indexOf(".rpc('increment_storage_usage'")
    const createVersionPos = source.indexOf(".rpc('create_video_version'")
    assert.ok(incrementPos > -1, 'increment_storage_usage RPC must be called')
    assert.ok(createVersionPos > -1, 'create_video_version RPC must be called')
    assert.ok(
      incrementPos < createVersionPos,
      'quota increment must happen before version creation'
    )
  })

  it('uses headObject contentLength for quota (not client-declared size)', () => {
    assert.match(source, /head\.contentLength/)
    assert.doesNotMatch(
      source,
      /actualFileSize\s*=\s*head\?\.contentLength/,
      'Must not use optional chaining fallback to client-declared size'
    )
  })

  it('rolls back quota on version creation failure', () => {
    assert.match(source, /decrement_storage_usage/)
  })

  it('applies rate limiting with user-scoped key', () => {
    assert.match(source, /upload:complete:user/)
  })

  it('uses UPLOAD_RATE_LIMIT and UPLOAD_RATE_WINDOW constants', () => {
    assert.match(source, /UPLOAD_RATE_LIMIT/)
    assert.match(source, /UPLOAD_RATE_WINDOW/)
  })

  it('uses requireUploadRole, not requireAgentRole', () => {
    assert.match(source, /requireUploadRole/)
    assert.doesNotMatch(source, /requireAgentRole/)
  })

  it('video verification select includes talent_id and status', () => {
    assert.match(source, /\.select\('id, agency_id, talent_id, status'\)/)
  })

  it('the response includes the resulting status alongside version and videoId', () => {
    const returnBlock = source.slice(source.lastIndexOf('return NextResponse.json({'))
    assert.match(returnBlock, /version: newVersion/)
    assert.match(returnBlock, /videoId,/)
    assert.match(returnBlock, /status: flipped \? 'pending_review' : currentStatus/)
  })

  // ── TOCTOU guard on the status flip ─────────────────────────────────────

  it('re-reads the CURRENT status before the flip decision (not the stale top-of-route read)', () => {
    // The fresh single-column select must exist and precede the eligibility check.
    const freshReadPos = source.indexOf(".select('status')")
    const eligibilityPos = source.indexOf('shouldFlipOnTalentUpload(currentStatus)')
    assert.ok(freshReadPos > -1, 'fresh status re-read must exist')
    assert.ok(eligibilityPos > -1, 'flip eligibility must check currentStatus')
    assert.ok(freshReadPos < eligibilityPos, 'the re-read must happen before the flip decision')
  })

  it('skips the flip when the status re-read fails (upload still returns 200)', () => {
    assert.match(source, /Status re-read failed — skipping auto-flip/)
  })

  it('AWAITS the notification enqueue (fire-and-forget gets dropped when Vercel freezes the fn)', () => {
    // Live-verified on staging: an unawaited insert as the last async op before
    // the response never completes. The enqueue never throws, so awaiting is safe.
    assert.match(source, /await enqueueUploadNotification\(/)
    assert.doesNotMatch(source, /enqueueUploadNotification\([\s\S]*?\)\s*\.catch/)
  })

  // ── Talent resubmit (S4-REVIEW-003): v(N+1) on changes_requested ─────────

  it('resubmit: the flip sends the existing upload alert, and no new notification type exists', async () => {
    const block = source.slice(source.indexOf('flipped = true'))
    assert.match(block, /await enqueueUploadNotification\(/)
    const fs = await import('node:fs')
    const path = await import('node:path')
    const notifications = fs.readFileSync(
      path.resolve(import.meta.dirname ?? __dirname, '../../../../../lib/notifications.ts'),
      'utf8'
    )
    const types = [...notifications.matchAll(/type: '(\w+)' as const/g)].map((m) => m[1])
    assert.deepEqual(types.sort(), ['new_comment', 'status_changed'])
  })

  // ── R2 key binding ───────────────────────────────────────────────────────

  it('rejects an r2Key that does not belong to this agency/video with 400', () => {
    assert.match(source, /r2Key\.startsWith\(`\$\{agencyId\}\/\$\{videoId\}\/`\)/)
    assert.match(source, /R2 key does not match video/)
  })

  it('binds the r2Key BEFORE any storage/RPC call uses it', () => {
    const bindPos = source.indexOf('R2 key does not match video')
    const multipartCompletePos = source.indexOf('completeMultipartUpload')
    const headObjectPos = source.indexOf('headObject(')
    const rpcPos = source.indexOf(".rpc('create_video_version'")
    assert.ok(bindPos > -1)
    assert.ok(bindPos < multipartCompletePos, 'key check must precede completeMultipartUpload')
    assert.ok(bindPos < headObjectPos, 'key check must precede headObject')
    assert.ok(bindPos < rpcPos, 'key check must precede create_video_version')
  })
})

describe('complete route — r2Key binding (replicated)', () => {
  function r2KeyMatchesVideo(r2Key: string, agencyId: string, videoId: string): boolean {
    return r2Key.startsWith(`${agencyId}/${videoId}/`)
  }

  it('accepts the key shape generateR2Key produces', () => {
    assert.equal(r2KeyMatchesVideo('agency-1/video-1/upload-uuid.mp4', 'agency-1', 'video-1'), true)
  })

  it('rejects a key under another video', () => {
    assert.equal(r2KeyMatchesVideo('agency-1/video-2/upload.mp4', 'agency-1', 'video-1'), false)
  })

  it('rejects a key under another agency', () => {
    assert.equal(r2KeyMatchesVideo('agency-2/video-1/upload.mp4', 'agency-1', 'video-1'), false)
  })

  it('rejects a prefix-collision key missing the trailing slash boundary', () => {
    // videoId 'video-1' must not match 'video-10'
    assert.equal(r2KeyMatchesVideo('agency-1/video-10/upload.mp4', 'agency-1', 'video-1'), false)
  })
})
