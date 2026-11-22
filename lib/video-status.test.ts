import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  NO_OPEN_COMMENTS_MESSAGE,
  changedByLabel,
  decideStatusChange,
  isEmailLike,
  VideoStatusError,
  isRetryableStatusError,
  patchVideoStatus,
  shouldAutoOpen,
  statusConfirmation,
  statusGuardError,
} from './video-status'

describe('unknown open-comment count (null) is never treated as zero', () => {
  it('does not refuse changes_requested', () => {
    assert.equal(statusGuardError('changes_requested', null), null)
    assert.deepEqual(decideStatusChange('in_review', 'changes_requested', null), {
      action: 'apply',
    })
  })

  it('does not warn on approve, but still confirms leaving Approved', () => {
    assert.equal(statusConfirmation('in_review', 'approved', null), null)
    assert.equal(decideStatusChange('approved', 'in_review', null).action, 'confirm')
  })
})

describe('decideStatusChange', () => {
  it('refuses changes_requested with zero open comments', () => {
    assert.deepEqual(decideStatusChange('in_review', 'changes_requested', 0), {
      action: 'refuse',
      message: NO_OPEN_COMMENTS_MESSAGE,
    })
  })

  it('confirms approve with open comments, naming the count', () => {
    const d = decideStatusChange('in_review', 'approved', 2)
    assert.equal(d.action, 'confirm')
    assert.equal(
      d.action === 'confirm' && d.confirmation.message,
      '2 comments are still open. Approve anyway?'
    )
  })

  it('confirms leaving Approved, applies everything else directly', () => {
    assert.equal(decideStatusChange('approved', 'changes_requested', 1).action, 'confirm')
    assert.equal(decideStatusChange('pending_review', 'in_review', 0).action, 'apply')
    assert.equal(decideStatusChange('in_review', 'approved', 0).action, 'apply')
  })
})

describe('changedByLabel', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('reads "Changed by {name}, {relative time}"', () => {
    assert.equal(changedByLabel('Alex Agent', ago(3 * 3_600_000)), 'Changed by Alex Agent, 3h ago')
  })

  it('never shows an email; falls back to "a team member"', () => {
    assert.ok(isEmailLike('a@b.co'))
    assert.equal(changedByLabel('a@b.co', ago(5 * 60_000)), 'Changed by a team member, 5m ago')
    assert.equal(changedByLabel(null, ago(5 * 60_000)), 'Changed by a team member, 5m ago')
  })

  it('is null with no timestamp', () => {
    assert.equal(changedByLabel('Alex Agent', null), null)
  })
})

describe('patchVideoStatus', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('rejects with the server message on a 409', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: 'Add an open comment', code: 'no_open_comments' },
        { status: 409 }
      )) as typeof fetch
    await assert.rejects(patchVideoStatus('v1', 'changes_requested'), /Add an open comment/)
  })

  it('resolves on 200 and sends the status as JSON', async () => {
    let sent: { url: string; body: string } | null = null
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) }
      return Response.json({ id: 'v1', status: 'approved' })
    }) as unknown as typeof fetch
    await patchVideoStatus('v1', 'approved')
    assert.deepEqual(sent, {
      url: '/api/videos/v1/status',
      body: JSON.stringify({ status: 'approved' }),
    })
  })
})

describe('statusGuardError', () => {
  it('refuses changes_requested with zero open comments', () => {
    assert.equal(statusGuardError('changes_requested', 0), NO_OPEN_COMMENTS_MESSAGE)
  })

  it('allows changes_requested with at least one open comment', () => {
    assert.equal(statusGuardError('changes_requested', 1), null)
    assert.equal(statusGuardError('changes_requested', 5), null)
  })

  it('never blocks other statuses, including approve with open comments', () => {
    assert.equal(statusGuardError('approved', 3), null)
    assert.equal(statusGuardError('approved', 0), null)
    assert.equal(statusGuardError('in_review', 0), null)
    assert.equal(statusGuardError('pending_review', 0), null)
  })
})

describe('statusConfirmation', () => {
  it('warns with the count when approving with open comments (plural)', () => {
    const c = statusConfirmation('in_review', 'approved', 3)
    assert.equal(c?.kind, 'approve_with_open')
    assert.equal(c?.message, '3 comments are still open. Approve anyway?')
  })

  it('uses singular for one open comment', () => {
    assert.equal(
      statusConfirmation('in_review', 'approved', 1)?.message,
      '1 comment is still open. Approve anyway?'
    )
  })

  it('does not prompt when approving with no open comments', () => {
    assert.equal(statusConfirmation('in_review', 'approved', 0), null)
  })

  it('confirms when leaving approved', () => {
    for (const to of ['draft', 'pending_review', 'in_review', 'changes_requested'] as const) {
      assert.equal(statusConfirmation('approved', to, 2)?.kind, 'leave_approved')
    }
  })

  it('does not prompt for other moves or a no-op', () => {
    assert.equal(statusConfirmation('pending_review', 'in_review', 4), null)
    assert.equal(statusConfirmation('in_review', 'changes_requested', 2), null)
    assert.equal(statusConfirmation('approved', 'approved', 2), null)
  })
})

describe('shouldAutoOpen (S5-FLOW-002)', () => {
  it('fires for agent roles on pending_review only', () => {
    for (const r of ['owner', 'admin_agent', 'agent']) {
      assert.equal(shouldAutoOpen(r, 'pending_review'), true)
      assert.equal(shouldAutoOpen(r, 'in_review'), false)
      assert.equal(shouldAutoOpen(r, 'approved'), false)
    }
  })

  it('never fires for talent, unknown or not-yet-loaded roles, or an unloaded status', () => {
    assert.equal(shouldAutoOpen('talent', 'pending_review'), false)
    assert.equal(shouldAutoOpen('guest', 'pending_review'), false)
    assert.equal(shouldAutoOpen(null, 'pending_review'), false)
    assert.equal(shouldAutoOpen('agent', null), false)
  })
})

describe('patchVideoStatus autoOpen', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  it('sends autoOpen only when asked', async () => {
    const bodies: unknown[] = []
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await patchVideoStatus('v', 'in_review', { autoOpen: true })
    await patchVideoStatus('v', 'approved')
    assert.deepEqual(bodies, [{ status: 'in_review', autoOpen: true }, { status: 'approved' }])
  })
})

describe('auto-open retry scope', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })
  const failWith = async (status: number | 'network') => {
    globalThis.fetch = (async () => {
      if (status === 'network') throw new TypeError('offline')
      return new Response('{}', { status })
    }) as typeof fetch
    return patchVideoStatus('v', 'in_review', { autoOpen: true }).then(
      () => null,
      (e: unknown) => e
    )
  }

  it('retries on network error, 429 and 5xx', async () => {
    for (const s of ['network', 429, 500, 503] as const) {
      assert.equal(isRetryableStatusError(await failWith(s)), true, String(s))
    }
  })

  it('never retries on 400, 403, 404 or 409', async () => {
    for (const s of [400, 403, 404, 409] as const) {
      const err = await failWith(s)
      assert.ok(err instanceof VideoStatusError)
      assert.equal(err.status, s)
      assert.equal(isRetryableStatusError(err), false, String(s))
    }
  })
})
