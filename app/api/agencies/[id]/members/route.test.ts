/**
 * Unit tests for POST /api/agencies/[id]/members.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed. The route
 * builds its own Supabase clients from `cookies()` / env vars (no dependency
 * injection), so — matching this repo's convention for such routes (see
 * app/api/notifications/route.test.ts, app/api/agencies/[id]/billing/route.test.ts)
 * — these are source-pattern tests that read route.ts and regex-verify the
 * security-critical invariants, including the exact caller-role → grantable-role
 * matrix (not just that *a* check exists).
 *
 * S3-SEC-005 regression: the caller-admission check (owner|admin_agent may call
 * this route at all) used to be the ONLY authorization check — the grantable-role
 * allowlist (ALLOWED_MEMBER_ROLES) covered all three roles regardless of caller,
 * so an admin_agent could mint an owner membership. Fixed via
 * GRANTABLE_ROLES_BY_CALLER, keyed by the caller's own role:
 *   - admin_agent POST role=owner       -> 403 (not in admin_agent's grantable set)
 *   - admin_agent POST role=admin_agent -> 403 (not in admin_agent's grantable set)
 *   - admin_agent POST role=agent       -> allowed (in admin_agent's grantable set)
 *   - owner POST role=owner             -> allowed (in owner's grantable set)
 *   - owner POST role=admin_agent       -> allowed (in owner's grantable set)
 *   - owner POST role=agent             -> allowed (in owner's grantable set)
 *
 * Run: npx tsx --test "app/api/agencies/[id]/members/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('members route — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('requires authentication — returns 401', () => {
    assert.match(source, /status: 401/)
  })

  it('caller must hold owner or admin_agent to add members at all', () => {
    assert.match(source, /ADD_MEMBER_ROLES\s*=\s*new Set\(\['owner',\s*'admin_agent'\]\)/)
    assert.match(
      source,
      /!callerMembership\s*\|\|\s*!ADD_MEMBER_ROLES\.has\(callerMembership\.role\)/
    )
  })

  it('defines the grantable-role matrix keyed by caller role (not one shared allowlist)', () => {
    assert.match(source, /GRANTABLE_ROLES_BY_CALLER/)
  })

  it("owner's grantable set includes all three roles: owner, admin_agent, agent", () => {
    assert.match(source, /owner:\s*new Set\(\['owner',\s*'admin_agent',\s*'agent'\]\)/)
  })

  it("admin_agent's grantable set is agent ONLY (cannot grant owner or admin_agent)", () => {
    assert.match(source, /admin_agent:\s*new Set\(\['agent'\]\)/)
    // Regression guard: admin_agent's set must not also list owner/admin_agent.
    assert.doesNotMatch(source, /admin_agent:\s*new Set\(\['agent',\s*'owner'/)
    assert.doesNotMatch(source, /admin_agent:\s*new Set\(\['agent',\s*'admin_agent'/)
  })

  it('looks up the grantable set by the CALLER role, then checks the NEW role against it', () => {
    assert.match(source, /GRANTABLE_ROLES_BY_CALLER\[callerMembership\.role\]/)
    assert.match(source, /!grantableRoles\s*\|\|\s*!grantableRoles\.has\(newRole\)/)
  })

  it('denies grantable-role violations with 403 (not silently downgraded or 400/401)', () => {
    assert.match(
      source,
      /if \(!grantableRoles \|\| !grantableRoles\.has\(newRole\)\)\s*\{[\s\S]{0,200}status:\s*403/
    )
  })

  it('the grantable-role check runs on the parsed body role, after ALLOWED_MEMBER_ROLES validation', () => {
    const allowedIdx = source.indexOf('ALLOWED_MEMBER_ROLES.includes')
    const grantableIdx = source.indexOf('GRANTABLE_ROLES_BY_CALLER[callerMembership.role]')
    assert.ok(allowedIdx > -1 && grantableIdx > -1, 'both checks must be present')
    assert.ok(
      allowedIdx < grantableIdx,
      'shape validation must run before the grant-authority check'
    )
  })

  it("keeps audit action 'role_changed' (0001 enum has no member_added value)", () => {
    assert.match(source, /action:\s*'role_changed'/)
  })

  it("tags member-add audit entries with metadata.event = 'member_added'", () => {
    assert.match(source, /metadata:\s*\{\s*event:\s*'member_added'/)
  })

  it('preserves the pre-existing metadata fields (user_id, role) alongside event', () => {
    assert.match(
      source,
      /metadata:\s*\{\s*event:\s*'member_added',\s*user_id:\s*newUserId,\s*role:\s*newRole\s*\}/
    )
  })

  it('applies rate limiting', () => {
    assert.match(source, /checkRateLimit/)
  })

  it('validates agency UUID', () => {
    assert.match(source, /isValidUUID\(agencyId\)/)
  })

  it('validates the new member user_id as a UUID', () => {
    assert.match(source, /isValidUUID\(b\.user_id\)/)
  })

  it('uses service role client for privileged DB writes (createClient)', () => {
    assert.match(source, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('uses createServerClient for auth', () => {
    assert.match(source, /createServerClient/)
  })

  it('checks the plan seat limit before inserting the membership', () => {
    const gateIdx = source.indexOf('checkPlanLimit(')
    const insertIdx = source.indexOf(".from('memberships')\n    .insert(")
    assert.ok(gateIdx > -1 && insertIdx > -1)
    assert.ok(gateIdx < insertIdx, 'plan gate must run before the insert')
  })
})

// ---------------------------------------------------------------------------
// Caller-role grant matrix — re-derives the exact GRANTABLE_ROLES_BY_CALLER
// object literal from source and exercises it directly, so this test fails
// if the matrix's *values* ever regress (not just its presence).
// ---------------------------------------------------------------------------

describe('S3-SEC-005 — caller-role grant matrix (derived from route source)', () => {
  let grantableRolesByCaller: Record<string, Set<string>>

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    const match = source.match(/GRANTABLE_ROLES_BY_CALLER:[^=]*=\s*\{([\s\S]*?)\n\}/)
    assert.ok(match, 'GRANTABLE_ROLES_BY_CALLER object literal must be present in route.ts')

    grantableRolesByCaller = {}
    const entryPattern = /(\w+):\s*new Set\(\[([^\]]*)\]\)/g
    let entry: RegExpExecArray | null
    while ((entry = entryPattern.exec(match[1])) !== null) {
      const [, callerRole, rolesList] = entry
      const roles = rolesList
        .split(',')
        .map((r) => r.trim().replace(/^'|'$/g, ''))
        .filter(Boolean)
      grantableRolesByCaller[callerRole] = new Set(roles)
    }
  })

  function canGrant(callerRole: string, targetRole: string): boolean {
    return grantableRolesByCaller[callerRole]?.has(targetRole) ?? false
  }

  it('admin_agent POST role=owner -> denied (403)', () => {
    assert.equal(canGrant('admin_agent', 'owner'), false)
  })

  it('admin_agent POST role=admin_agent -> denied (403)', () => {
    assert.equal(canGrant('admin_agent', 'admin_agent'), false)
  })

  it('admin_agent POST role=agent -> allowed', () => {
    assert.equal(canGrant('admin_agent', 'agent'), true)
  })

  it('owner POST role=owner -> allowed', () => {
    assert.equal(canGrant('owner', 'owner'), true)
  })

  it('owner POST role=admin_agent -> allowed', () => {
    assert.equal(canGrant('owner', 'admin_agent'), true)
  })

  it('owner POST role=agent -> allowed', () => {
    assert.equal(canGrant('owner', 'agent'), true)
  })
})
