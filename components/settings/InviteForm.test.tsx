/**
 * InviteForm + invite helpers — executes the role-bounding, request-shape and
 * error-handling logic (no DOM runtime in this repo; the component is a thin
 * wrapper over these helpers, verified with light source invariants).
 *
 * Run: npx tsx --test "components/settings/InviteForm.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INVITE_PERMISSIONS,
  buildInvitePayload,
  canInvite,
  getInvitableRoles,
  submitInvite,
} from '../../lib/invite-permissions.js'

describe('role options per inviter role', () => {
  it('owner and admin_agent can invite admin_agent, agent, talent', () => {
    assert.deepEqual(getInvitableRoles('owner'), ['admin_agent', 'agent', 'talent'])
    assert.deepEqual(getInvitableRoles('admin_agent'), ['admin_agent', 'agent', 'talent'])
  })

  it('agent can only invite talent (never owner/admin_agent)', () => {
    assert.deepEqual(getInvitableRoles('agent'), ['talent'])
  })

  it('no inviter can ever offer owner', () => {
    for (const roles of Object.values(INVITE_PERMISSIONS)) {
      assert.ok(!(roles as string[]).includes('owner'))
    }
  })

  it('talent and unknown roles cannot invite', () => {
    assert.equal(canInvite('talent'), false)
    assert.equal(canInvite('guest'), false)
    assert.deepEqual(getInvitableRoles('talent'), [])
    assert.equal(canInvite('agent'), true)
  })
})

describe('buildInvitePayload', () => {
  it('sends exactly { email, role, agencyId } with trimmed email', () => {
    assert.deepEqual(buildInvitePayload('  a@b.co ', 'talent', 'ag-1'), {
      email: 'a@b.co',
      role: 'talent',
      agencyId: 'ag-1',
    })
  })
})

function fakeFetch(status: number, body: unknown, capture?: { url?: string; init?: RequestInit }) {
  return (async (url: string, init?: RequestInit) => {
    if (capture) {
      capture.url = url
      capture.init = init
    }
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

describe('submitInvite', () => {
  it('POSTs JSON to /api/invitations/send and returns ok', async () => {
    const cap: { url?: string; init?: RequestInit } = {}
    const payload = buildInvitePayload('x@y.co', 'agent', 'ag-9')
    const res = await submitInvite(payload, fakeFetch(200, { success: true }, cap))
    assert.deepEqual(res, { ok: true })
    assert.equal(cap.url, '/api/invitations/send')
    assert.equal(cap.init?.method, 'POST')
    assert.deepEqual(JSON.parse(cap.init?.body as string), payload)
  })

  it('surfaces the route error message (plan gate 402)', async () => {
    const res = await submitInvite(
      buildInvitePayload('x@y.co', 'agent', 'a'),
      fakeFetch(402, { error: 'Your plan is past due — please update payment.' })
    )
    assert.deepEqual(res, { ok: false, error: 'Your plan is past due — please update payment.' })
  })

  it('surfaces the 429 message, with a fallback when the body has none', async () => {
    const p = buildInvitePayload('x@y.co', 'agent', 'a')
    assert.deepEqual(
      await submitInvite(
        p,
        fakeFetch(429, { error: 'Too many invitations. Please try again later.' })
      ),
      { ok: false, error: 'Too many invitations. Please try again later.' }
    )
    const fallback = await submitInvite(p, fakeFetch(429, 'not json'))
    assert.equal(fallback.ok, false)
    assert.match((fallback as { error: string }).error, /Too many invitations/)
  })

  it('returns a network error message when fetch throws', async () => {
    const res = await submitInvite(buildInvitePayload('x@y.co', 'agent', 'a'), (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch)
    assert.equal(res.ok, false)
  })
})

describe('InviteForm component wiring', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const source = fs.readFileSync(path.resolve(dir, 'InviteForm.tsx'), 'utf8')

  it('bounds options via getInvitableRoles, submits via submitInvite, refreshes on success', () => {
    assert.match(source, /getInvitableRoles\(inviterRole\)/)
    assert.match(source, /submitInvite\(/)
    assert.match(source, /router\.refresh\(\)/)
    assert.match(source, /setEmail\(''\)/)
  })
})
