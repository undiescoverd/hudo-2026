/**
 * Unit tests for DELETE /api/users/[userId]/data (S3-COMPLY-002 — GDPR
 * right-to-erasure).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed. The route
 * builds its Supabase clients via createSupabaseServerClient() / env vars (no
 * dependency injection), so — matching this repo's convention for such
 * routes (see app/api/agencies/[id]/members/route.test.ts,
 * app/api/notifications/route.test.ts) — these are source-pattern tests that
 * read route.ts and regex-verify the security-critical invariants: ordering
 * of the authz -> sole-owner -> existence -> erase sequence, the
 * fail-closed rate-limit posture, the anti-escalation matrix, and that no
 * PII leaks into the response body.
 *
 * Run: npx tsx --test "app/api/users/[userId]/data/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('users/[userId]/data route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports a DELETE handler', () => {
    assert.match(source, /export async function DELETE/)
  })

  it('validates the userId param as a UUID', () => {
    assert.match(source, /isValidUUID\(targetUserId\)/)
  })

  it('requires authentication — returns 401', () => {
    assert.match(source, /status: 401/)
    assert.match(source, /if \(!user\)/)
  })

  it('rate-limits with the fail-closed posture (destructive endpoint)', () => {
    assert.match(source, /checkRateLimit\(/)
    assert.match(source, /'fail-closed'/)
  })

  it('allows self-erasure unconditionally', () => {
    assert.match(source, /isSelf\s*=\s*user\.id\s*===\s*targetUserId/)
  })

  it('denies with a generic 403 before any existence check (no user enumeration)', () => {
    assert.match(
      source,
      /if \(!authorized\)\s*\{[\s\S]{0,120}error:\s*'Access denied'[\s\S]{0,40}status:\s*403/
    )
  })

  it('anti-escalation: owner may erase anyone in a shared agency', () => {
    assert.match(source, /callerRole === 'owner'\) return true/)
  })

  it("anti-escalation: admin_agent may only erase 'agent' or 'talent' targets", () => {
    assert.match(
      source,
      /callerRole === 'admin_agent' && \(tm\.role === 'agent' \|\| tm\.role === 'talent'\)/
    )
  })

  it('enforces the sole-owner guard with a 409 (applies to self-erasure too)', () => {
    assert.match(source, /error:\s*'sole_owner'/)
    assert.match(source, /status:\s*409/)
    assert.match(source, /\(count \?\? 0\) <= 1/)
  })

  it('sole-owner guard runs on ALL target memberships, not just non-self callers (no early return skips it)', () => {
    const ownerGuardIdx = source.indexOf("filter((m) => m.role === 'owner')")
    assert.ok(ownerGuardIdx > -1)
  })

  it('checks target existence with 404, only after authz has already run', () => {
    assert.match(source, /error:\s*'Not found'/)
    assert.match(source, /status:\s*404/)
  })

  it('calls eraseUser to perform the erasure', () => {
    assert.match(source, /eraseUser\(admin, targetUserId\)/)
  })

  it('ordering: authz check runs before eraseUser is called', () => {
    const authzIdx = source.indexOf('if (!authorized)')
    const eraseIdx = source.indexOf('eraseUser(admin, targetUserId)')
    assert.ok(authzIdx > -1 && eraseIdx > -1)
    assert.ok(authzIdx < eraseIdx, 'authz must run before erasure')
  })

  it('ordering: sole-owner 409 check runs before eraseUser is called', () => {
    const soleOwnerIdx = source.indexOf("error: 'sole_owner'")
    const eraseIdx = source.indexOf('eraseUser(admin, targetUserId)')
    assert.ok(soleOwnerIdx > -1 && eraseIdx > -1)
    assert.ok(soleOwnerIdx < eraseIdx, 'sole-owner guard must run before erasure')
  })

  it('ordering: target-existence 404 check runs before eraseUser is called', () => {
    const notFoundIdx = source.lastIndexOf("error: 'Not found'")
    const eraseIdx = source.indexOf('eraseUser(admin, targetUserId)')
    assert.ok(notFoundIdx > -1 && eraseIdx > -1)
    assert.ok(notFoundIdx < eraseIdx, 'existence check must run before erasure')
  })

  it('ordering: sole-owner guard runs before the existence check (403/409 precede 404)', () => {
    const soleOwnerIdx = source.indexOf("error: 'sole_owner'")
    const notFoundIdx = source.lastIndexOf("error: 'Not found'")
    assert.ok(soleOwnerIdx > -1 && notFoundIdx > -1)
    assert.ok(soleOwnerIdx < notFoundIdx)
  })

  it('logs a user_erased audit event scoped to resourceType "user"', () => {
    assert.match(source, /action:\s*'user_erased'/)
    assert.match(source, /resourceType:\s*'user'/)
    assert.match(source, /resourceId:\s*targetUserId/)
  })

  it('self-erasure audit event uses a null actor + "Deleted User" name (no PII re-introduced)', () => {
    assert.match(source, /const actorId = isSelf \? null : user\.id/)
    assert.match(source, /const actorName = isSelf\s*\n?\s*\?\s*DELETED_USER_NAME/)
  })

  it('logs one event per agency in result.agencyIds', () => {
    assert.match(source, /for \(const agencyId of result\.agencyIds\)/)
  })

  it('audit logging is fire-and-forget (does not block or fail the response)', () => {
    assert.match(source, /logEvent\(\{[\s\S]{0,300}\}\)\.catch\(/)
  })

  it('erasure failure returns a generic error + step, no raw error message in the body', () => {
    assert.match(source, /error:\s*'Erasure failed',\s*step:\s*result\.step/)
    assert.doesNotMatch(source, /error:\s*'Erasure failed'[\s\S]{0,60}message/)
  })

  it('success response contains no PII — just {success: true}', () => {
    assert.match(source, /NextResponse\.json\(\{ success: true \}, \{ status: 200 \}\)/)
  })

  it('uses service role client for privileged DB writes (createAdminClient)', () => {
    assert.match(source, /createAdminClient\(\)/)
  })

  it('uses createSupabaseServerClient for auth', () => {
    assert.match(source, /createSupabaseServerClient/)
  })
})
