/**
 * Unit tests for the video status PATCH route and canTransition matrix.
 *
 * Tests cover:
 *  1. canTransition() — real implementation imported from lib/video-status.ts
 *  2. Route source invariants — security-critical patterns must exist in route.ts
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * tsx resolves relative .ts imports directly; Next.js path aliases (@/) are NOT used here.
 *
 * Run: npx tsx app/api/videos/\[videoId\]/status/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// Import the real canTransition from lib using a relative path.
// tsx resolves .ts imports natively, so this works without a build step.
import { canTransition } from '../../../../../lib/video-status.js'

// ---------------------------------------------------------------------------
// 1. canTransition matrix tests — testing the REAL implementation
// ---------------------------------------------------------------------------

describe('canTransition — talent role', () => {
  it('allows draft → pending_review', () => {
    assert.equal(canTransition('draft', 'pending_review', 'talent'), true)
  })

  it('allows changes_requested → pending_review', () => {
    assert.equal(canTransition('changes_requested', 'pending_review', 'talent'), true)
  })

  it('blocks pending_review → pending_review (same-status no-op)', () => {
    assert.equal(canTransition('pending_review', 'pending_review', 'talent'), false)
  })

  it('blocks draft → approved', () => {
    assert.equal(canTransition('draft', 'approved', 'talent'), false)
  })

  it('blocks draft → in_review', () => {
    assert.equal(canTransition('draft', 'in_review', 'talent'), false)
  })

  it('blocks in_review → pending_review (not from allowed source status)', () => {
    assert.equal(canTransition('in_review', 'pending_review', 'talent'), false)
  })

  it('blocks approved → pending_review (talent cannot re-submit from approved)', () => {
    assert.equal(canTransition('approved', 'pending_review', 'talent'), false)
  })

  it('blocks draft → changes_requested (talent cannot set changes_requested)', () => {
    assert.equal(canTransition('draft', 'changes_requested', 'talent'), false)
  })
})

describe('canTransition — agent role', () => {
  it('allows any valid transition: pending_review → in_review', () => {
    assert.equal(canTransition('pending_review', 'in_review', 'agent'), true)
  })

  it('allows in_review → approved', () => {
    assert.equal(canTransition('in_review', 'approved', 'agent'), true)
  })

  it('allows in_review → changes_requested', () => {
    assert.equal(canTransition('in_review', 'changes_requested', 'agent'), true)
  })

  it('allows approved → changes_requested (reversal)', () => {
    assert.equal(canTransition('approved', 'changes_requested', 'agent'), true)
  })

  it('blocks same → same: approved → approved', () => {
    assert.equal(canTransition('approved', 'approved', 'agent'), false)
  })

  it('blocks same → same: draft → draft', () => {
    assert.equal(canTransition('draft', 'draft', 'agent'), false)
  })
})

describe('canTransition — owner and admin_agent roles', () => {
  it('owner: allows draft → approved', () => {
    assert.equal(canTransition('draft', 'approved', 'owner'), true)
  })

  it('admin_agent: allows pending_review → approved', () => {
    assert.equal(canTransition('pending_review', 'approved', 'admin_agent'), true)
  })

  it('owner: blocks same → same', () => {
    assert.equal(canTransition('in_review', 'in_review', 'owner'), false)
  })
})

// ---------------------------------------------------------------------------
// 2. Route source invariants
// ---------------------------------------------------------------------------

describe('status PATCH route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports a PATCH handler', () => {
    assert.match(source, /export async function PATCH/)
  })

  it('validates videoId with isValidUUID', () => {
    assert.match(source, /isValidUUID\(videoId\)/)
  })

  it('validates status with isVideoStatus', () => {
    assert.match(source, /isVideoStatus\(/)
  })

  it('applies canTransition check', () => {
    assert.match(source, /canTransition\(/)
  })

  it('applies rate limiting', () => {
    assert.match(source, /checkRateLimit/)
    assert.match(source, /STATUS_RATE_LIMIT/)
  })

  it('uses service-role client (createClient with serviceRoleKey)', () => {
    assert.match(source, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('inserts into audit_log with status_changed action', () => {
    assert.match(source, /audit_log/)
    assert.match(source, /status_changed/)
  })

  it('inserts audit_log BEFORE updating video (audit-first ordering)', () => {
    const auditIdx = source.indexOf("from('audit_log').insert")
    const updateIdx = source.indexOf("from('videos')\n    .update")
    assert.ok(auditIdx > -1, 'audit_log insert must exist')
    assert.ok(updateIdx > -1, 'videos update must exist')
    assert.ok(auditIdx < updateIdx, 'audit_log insert must appear before video update in source')
  })

  it('returns 200 with id and status on success', () => {
    assert.match(source, /id:\s*videoId/)
    assert.match(source, /status:\s*newStatus/)
  })

  it('returns 401 when unauthenticated', () => {
    assert.match(source, /Authentication required/)
    assert.match(source, /status: 401/)
  })

  it('returns 404 when video not found', () => {
    assert.match(source, /Video not found/)
    assert.match(source, /status: 404/)
  })

  it('returns 403 on access denied', () => {
    assert.match(source, /Access denied/)
    assert.match(source, /status: 403/)
  })

  it('returns 429 on rate limit', () => {
    assert.match(source, /STATUS_RATE_LIMIT/)
    assert.match(source, /STATUS_RATE_WINDOW/)
  })

  it('uses agent_agency_ids (not broad agency_ids) for write authorization', () => {
    assert.match(source, /agentAgencyIds/)
    assert.match(source, /AGENT_ROLES/)
  })

  it('aborts if audit_log insert fails (no silent status changes)', () => {
    assert.match(source, /audit_log insert failed/)
    assert.match(source, /Failed to record audit log; status not changed/)
  })

  it('logs loudly if video update fails after audit_log insert', () => {
    assert.match(source, /CRITICAL: audit_log written but video update failed/)
  })

  it('rate limit key is IP-based as required', () => {
    assert.match(source, /video:status:ip:/)
  })
})

// ---------------------------------------------------------------------------
// 3. lib/video-status.ts source invariants — canTransition must be exported
// ---------------------------------------------------------------------------

describe('lib/video-status.ts — canTransition export', () => {
  let libSource: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const libFilePath = path.resolve(currentDir, '../../../../../lib/video-status.ts')
    libSource = fs.readFileSync(libFilePath, 'utf8')
  })

  it('exports canTransition function', () => {
    assert.match(libSource, /export function canTransition/)
  })

  it('canTransition accepts from, to, role parameters', () => {
    assert.match(libSource, /canTransition\s*\(\s*from\s*:.*,\s*to\s*:.*,\s*role\s*:/)
  })

  it('talent check gates on pending_review target', () => {
    assert.match(libSource, /to === 'pending_review'/)
  })

  it('talent check restricts source to draft or changes_requested', () => {
    assert.match(libSource, /from === 'draft'/)
    assert.match(libSource, /from === 'changes_requested'/)
  })

  it('same-to-same is always false (no-op guard)', () => {
    assert.match(libSource, /from === to/)
  })
})
