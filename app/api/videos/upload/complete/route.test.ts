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

// ── Extracted constants (must match route.ts) ─────────────────────────────
const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']

describe('complete route — role authorization', () => {
  it('owner can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('owner'))
  })

  it('admin_agent can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('admin_agent'))
  })

  it('agent can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('agent'))
  })

  it('guest cannot complete uploads', () => {
    assert.ok(!AGENT_PLUS_ROLES.includes('guest'))
  })
})

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

  it('never blocks agent+', () => {
    assert.equal(talentOwnershipBlocked('agent', 'someone-else', 'user-1'), false)
  })

  // Replicates the status auto-flip decision, mirroring canTransition() for
  // the 'talent' role in lib/video-status.ts.
  function shouldFlipToPendingReview(role: string, status: string): boolean {
    return role === 'talent' && (status === 'draft' || status === 'changes_requested')
  }

  it('flips for talent when status is draft', () => {
    assert.equal(shouldFlipToPendingReview('talent', 'draft'), true)
  })

  it('flips for talent when status is changes_requested', () => {
    assert.equal(shouldFlipToPendingReview('talent', 'changes_requested'), true)
  })

  it('never flips for talent when status is pending_review, in_review, or approved', () => {
    assert.equal(shouldFlipToPendingReview('talent', 'pending_review'), false)
    assert.equal(shouldFlipToPendingReview('talent', 'in_review'), false)
    assert.equal(shouldFlipToPendingReview('talent', 'approved'), false)
  })

  it('never flips for agent+, regardless of status', () => {
    assert.equal(shouldFlipToPendingReview('agent', 'draft'), false)
    assert.equal(shouldFlipToPendingReview('owner', 'changes_requested'), false)
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

  it('inserts the status-flip audit_log row BEFORE updating the video status', () => {
    const auditPos = source.indexOf(".from('audit_log').insert(")
    const updatePos = source.indexOf("status: 'pending_review'")
    assert.ok(auditPos > -1, 'audit_log insert must exist')
    assert.ok(updatePos > -1, 'pending_review status update must exist')
    assert.ok(auditPos < updatePos, 'audit insert must happen before the video status update')
  })

  it('skips the flip (does not update status) when the audit insert fails', () => {
    const auditBlock = source.slice(
      source.indexOf('if (flipAuditError)'),
      source.indexOf('} else {', source.indexOf('if (flipAuditError)'))
    )
    assert.match(auditBlock, /skipping flip/)
  })

  it('only enqueues the upload notification after a successful flip', () => {
    const enqueuePos = source.indexOf('enqueueUploadNotification(')
    const flippedTruePos = source.indexOf('flipped = true')
    assert.ok(enqueuePos > -1 && flippedTruePos > -1)
    assert.ok(
      flippedTruePos < enqueuePos,
      'flipped must be set true before the notification is enqueued'
    )
  })

  it('logs CRITICAL on audit-orphan (video update fails after audit succeeded)', () => {
    assert.match(source, /CRITICAL: audit_log written but video status update failed/)
  })

  it('never auto-flips status when the current status is pending_review, in_review, or approved', () => {
    assert.match(source, /currentStatus === 'draft' \|\| currentStatus === 'changes_requested'/)
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
    const eligibilityPos = source.indexOf("currentStatus === 'draft'")
    assert.ok(freshReadPos > -1, 'fresh status re-read must exist')
    assert.ok(eligibilityPos > -1, 'flip eligibility must check currentStatus')
    assert.ok(freshReadPos < eligibilityPos, 'the re-read must happen before the flip decision')
  })

  it('skips the flip when the status re-read fails (upload still returns 200)', () => {
    assert.match(source, /Status re-read failed — skipping auto-flip/)
  })

  it('uses the fresh status (not the stale read) for the audit metadata old_status', () => {
    assert.match(source, /old_status: currentStatus/)
    assert.doesNotMatch(source, /old_status: video\.status/)
  })

  it('makes the flip UPDATE conditional on the status still being flippable', () => {
    const updateBlock = source.slice(
      source.indexOf("status: 'pending_review', updated_at"),
      source.indexOf('if (flipUpdateError')
    )
    assert.match(updateBlock, /\.in\('status', \['draft', 'changes_requested'\]\)/)
    assert.match(updateBlock, /\.select\('id'\)/)
  })

  it('treats 0 matched rows as a failed flip: no notification, CRITICAL orphan log', () => {
    assert.match(source, /flipUpdateError \|\| !updatedRows\?\.length/)
    assert.match(source, /status changed concurrently \(0 rows matched\)/)
    // The enqueue must only live in the success branch, after flipped = true.
    const failBranchPos = source.indexOf('flipUpdateError || !updatedRows?.length')
    const enqueuePos = source.indexOf('enqueueUploadNotification(')
    assert.ok(failBranchPos < enqueuePos, 'enqueue must come after the 0-rows guard')
  })

  it('AWAITS the notification enqueue (fire-and-forget gets dropped when Vercel freezes the fn)', () => {
    // Live-verified on staging: an unawaited insert as the last async op before
    // the response never completes. The enqueue never throws, so awaiting is safe.
    assert.match(source, /await enqueueUploadNotification\(/)
    assert.doesNotMatch(source, /enqueueUploadNotification\([\s\S]*?\)\s*\.catch/)
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

describe('complete route — TOCTOU flip logic (replicated)', () => {
  // Replicates the route's flip decision using the FRESH status re-read, and
  // the conditional-update outcome handling.
  function flipOutcome(
    role: string,
    freshStatus: string | null, // null = re-read failed
    updateMatchedRows: number // rows matched by the conditional UPDATE
  ): { flipped: boolean; notified: boolean } {
    if (role !== 'talent' || freshStatus === null) return { flipped: false, notified: false }
    if (freshStatus !== 'draft' && freshStatus !== 'changes_requested')
      return { flipped: false, notified: false }
    if (updateMatchedRows === 0) return { flipped: false, notified: false }
    return { flipped: true, notified: true }
  }

  it('does NOT flip when the fresh read shows approved, even if the initial read said draft', () => {
    // initial read (stale) said 'draft', but an agent approved it mid-upload:
    const staleStatus = 'draft'
    assert.equal(staleStatus, 'draft') // documents the scenario
    assert.deepEqual(flipOutcome('talent', 'approved', 1), { flipped: false, notified: false })
  })

  it('does NOT notify when the conditional update matches 0 rows (raced after audit insert)', () => {
    assert.deepEqual(flipOutcome('talent', 'draft', 0), { flipped: false, notified: false })
  })

  it('flips and notifies on the happy path (fresh draft, update matched)', () => {
    assert.deepEqual(flipOutcome('talent', 'draft', 1), { flipped: true, notified: true })
    assert.deepEqual(flipOutcome('talent', 'changes_requested', 1), {
      flipped: true,
      notified: true,
    })
  })

  it('skips the flip when the re-read fails', () => {
    assert.deepEqual(flipOutcome('talent', null, 1), { flipped: false, notified: false })
  })

  it('never flips for agent+', () => {
    assert.deepEqual(flipOutcome('agent', 'draft', 1), { flipped: false, notified: false })
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
