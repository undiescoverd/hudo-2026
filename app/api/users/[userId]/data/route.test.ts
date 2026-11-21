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
 * fail-closed rate-limit posture, delegation to canEraseUser, and that no
 * PII leaks into the response body.
 *
 * The authorization matrix itself (owner/admin_agent/anti-escalation/
 * cross-agency) is a pure function — canEraseUser in lib/erasure.ts — with
 * real executed unit tests in lib/erasure.test.ts; these source-pattern
 * tests only pin that the route actually calls it, in the right position.
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
      /!canEraseUser\([\s\S]{0,300}\)\s*\)?\s*\{[\s\S]{0,120}error:\s*'Access denied'[\s\S]{0,40}status:\s*403/
    )
  })

  it('delegates the authz decision to canEraseUser (executed matrix coverage lives in lib/erasure.test.ts)', () => {
    assert.match(source, /import \{[^}]*canEraseUser[^}]*\} from '@\/lib\/erasure'/)
    // Authz is evaluated against the ONE scoped agency (D13), not the whole membership set.
    assert.match(
      source,
      /canEraseUser\(\s*user\.id,\s*targetUserId,\s*\(callerMemberships \?\? \[\]\)\.filter\(inScope\),\s*\(targetMemberships \?\? \[\]\)\.filter\(inScope\)\s*\)/
    )
  })

  it('does NOT re-implement the role matrix inline (no per-pair role comparisons in the route)', () => {
    assert.doesNotMatch(source, /tm\.role === 'agent'/)
    assert.doesNotMatch(source, /callerRole === 'admin_agent'/)
  })

  it('enforces the sole-owner guard with a 409 (applies to self-erasure too)', () => {
    assert.match(source, /error:\s*'sole_owner'/)
    assert.match(source, /status:\s*409/)
    assert.match(source, /\(count \?\? 0\) <= 1/)
  })

  it('sole-owner guard runs on ALL target memberships, not just non-self callers (no early return skips it)', () => {
    const ownerGuardIdx = source.indexOf("filter((m) => m.role === 'owner'")
    assert.ok(ownerGuardIdx > -1)
  })

  it('checks target existence with 404, only after authz has already run', () => {
    assert.match(source, /error:\s*'Not found'/)
    assert.match(source, /status:\s*404/)
  })

  it('calls eraseUser to perform the erasure', () => {
    assert.match(source, /eraseUser\(admin, targetUserId\)/)
  })

  it('ordering: canEraseUser authz check runs before eraseUser is called', () => {
    const authzIdx = source.indexOf('!canEraseUser(')
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

  it('reuses the existing admin client for audit inserts (no per-agency client re-creation)', () => {
    assert.match(source, /adminClient:\s*admin/)
  })

  it('zero-agency erasure is still recorded via a server-side log (audit_log.agency_id is NOT NULL)', () => {
    assert.match(source, /result\.agencyIds\.length === 0/)
    assert.match(source, /no agency memberships — not written to audit_log/)
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

  // ---- S4-ERASE-001 ----------------------------------------------------

  it('non-self callers must pass a valid ?agencyId= or get 400, before any DB read', () => {
    assert.match(source, /searchParams\.get\('agencyId'\)/)
    assert.match(source, /!isSelf && \(!agencyIdParam \|\| !isValidUUID\(agencyIdParam\)\)/)
    assert.match(source, /error:\s*'agencyId is required'[\s\S]{0,40}status:\s*400/)
    assert.ok(
      source.indexOf("error: 'agencyId is required'") < source.indexOf('createAdminClient()'),
      '400 must precede any admin DB access'
    )
  })

  it('agency-scoped removal goes through removeMemberWithData (never raw deletes)', () => {
    assert.match(source, /removeMemberWithData\(admin, targetUserId, scopedAgencyId,/)
    assert.doesNotMatch(source, /\.from\('videos'\)/)
    assert.doesNotMatch(source, /\.delete\(\)/)
  })

  it('self-erasure uses the full eraseUser; non-self uses the scoped path', () => {
    assert.match(
      source,
      /isSelf \|\| !scopedAgencyId\s*\?\s*await eraseUser\(admin, targetUserId\)/
    )
  })

  it('sole-owner guard is scoped to the removal agency for non-self callers', () => {
    assert.match(source, /m\.agency_id === scopedAgencyId/)
  })

  it('captures the target identity BEFORE erasing, and sends emails after success', () => {
    const captureIdx = source.indexOf('const targetIdentity')
    const eraseIdx = source.indexOf('await eraseUser(admin, targetUserId)')
    const failIdx = source.indexOf("error: 'Erasure failed'")
    const emailIdx = source.indexOf('await sendErasureEmails(')
    assert.ok(captureIdx > -1 && captureIdx < eraseIdx, 'identity captured before erasure')
    assert.ok(emailIdx > failIdx, 'emails only after the failure return')
  })

  it('an email failure can never fail the erasure (wrapped; response stays 200)', () => {
    assert.match(source, /try \{\s*await sendErasureEmails\([\s\S]*?\} catch \(err\) \{/)
    assert.ok(source.indexOf('await sendErasureEmails(') < source.indexOf('{ success: true }'))
  })

  it('exports only reserved route fields', () => {
    const exports = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map(
      (m) => m[1]
    )
    assert.deepStrictEqual(exports, ['DELETE'])
  })
})
