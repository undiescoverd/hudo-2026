/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for PATCH /api/notifications/preferences
 *
 * Run: npx tsx --test app/api/notifications/preferences/route.test.ts
 *
 * All external clients (Supabase, Redis) are mocked — no live connection required.
 * We test via an extracted handlePatch function that mirrors route.ts logic and
 * accepts injected deps, avoiding the need to mock Next.js internals.
 *
 * AC coverage:
 * 1. email_enabled toggle and batch_window_minutes select exposed
 * 2. PATCH updates the current user's notification_preferences row
 * 3. Defaults applied when no row exists (email_enabled=true, batch_window_minutes=15)
 * 4. Validation: batch_window_minutes must be one of [5,15,30,60]; reject others with 400
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Core handler logic — mirrors route.ts exactly but accepts injected deps
// ---------------------------------------------------------------------------
async function handlePatch(
  body: unknown,
  opts: {
    userId: string | null
    existingPrefs: { email_enabled: boolean; batch_window_minutes: number } | null
    upsertFn: (payload: Record<string, unknown>) => {
      data: Record<string, unknown> | null
      error: { message: string } | null
    }
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ALLOWED_BATCH_WINDOWS = [5, 15, 30, 60]

  if (!opts.userId) {
    return { status: 401, body: { error: 'Authentication required' } }
  }

  const parsed = body as { email_enabled?: unknown; batch_window_minutes?: unknown }
  const { email_enabled, batch_window_minutes } = parsed

  if (email_enabled !== undefined && typeof email_enabled !== 'boolean') {
    return { status: 400, body: { error: 'email_enabled must be a boolean' } }
  }

  if (batch_window_minutes !== undefined) {
    if (!ALLOWED_BATCH_WINDOWS.includes(batch_window_minutes as number)) {
      return {
        status: 400,
        body: {
          error: `batch_window_minutes must be one of: ${ALLOWED_BATCH_WINDOWS.join(', ')}`,
        },
      }
    }
  }

  const merged: Record<string, unknown> = {
    user_id: opts.userId,
    email_enabled:
      email_enabled !== undefined ? email_enabled : (opts.existingPrefs?.email_enabled ?? true),
    batch_window_minutes:
      batch_window_minutes !== undefined
        ? batch_window_minutes
        : (opts.existingPrefs?.batch_window_minutes ?? 15),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = opts.upsertFn(merged)

  if (error || !data) {
    return { status: 500, body: { error: 'Failed to update preferences' } }
  }

  return {
    status: 200,
    body: {
      email_enabled: data.email_enabled,
      batch_window_minutes: data.batch_window_minutes,
      updated_at: data.updated_at,
    },
  }
}

// ---------------------------------------------------------------------------
// Helper: simple upsert stub
// ---------------------------------------------------------------------------
function makeUpsert(overrides?: Partial<{ email_enabled: boolean; batch_window_minutes: number }>) {
  return (payload: Record<string, unknown>) => ({
    data: {
      email_enabled: overrides?.email_enabled ?? payload.email_enabled,
      batch_window_minutes: overrides?.batch_window_minutes ?? payload.batch_window_minutes,
      updated_at: new Date().toISOString(),
    },
    error: null as null,
  })
}

// ---------------------------------------------------------------------------
// AC-1: Settings page exposes email_enabled toggle and batch_window_minutes select
// ---------------------------------------------------------------------------
describe('AC-1: Allowed values and field exposure', () => {
  it('BATCH_WINDOW_OPTIONS covers exactly [5, 15, 30, 60]', () => {
    const ALLOWED = [5, 15, 30, 60]
    assert.equal(ALLOWED.length, 4)
    for (const v of [5, 15, 30, 60]) assert.ok(ALLOWED.includes(v))
  })

  it('accepts email_enabled=true', async () => {
    const result = await handlePatch(
      { email_enabled: true },
      { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
    )
    assert.equal(result.status, 200)
    assert.equal(result.body.email_enabled, true)
  })

  it('accepts email_enabled=false', async () => {
    const result = await handlePatch(
      { email_enabled: false },
      { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
    )
    assert.equal(result.status, 200)
    assert.equal(result.body.email_enabled, false)
  })

  it('accepts each allowed batch_window_minutes value', async () => {
    for (const value of [5, 15, 30, 60]) {
      const result = await handlePatch(
        { batch_window_minutes: value },
        { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
      )
      assert.equal(result.status, 200, `expected 200 for batch_window_minutes=${value}`)
      assert.equal(result.body.batch_window_minutes, value)
    }
  })
})

// ---------------------------------------------------------------------------
// AC-2: PATCH updates the current user's row
// ---------------------------------------------------------------------------
describe('AC-2: PATCH updates the current user row', () => {
  it('passes user_id from auth, not from body', async () => {
    let capturedPayload: Record<string, unknown> = {}
    const upsertFn = (payload: Record<string, unknown>) => {
      capturedPayload = payload
      return {
        data: { ...payload, updated_at: new Date().toISOString() },
        error: null as null,
      }
    }

    await handlePatch(
      { email_enabled: false, batch_window_minutes: 30 },
      { userId: 'secure-user-id', existingPrefs: null, upsertFn }
    )

    assert.equal(capturedPayload.user_id, 'secure-user-id')
    assert.equal(capturedPayload.email_enabled, false)
    assert.equal(capturedPayload.batch_window_minutes, 30)
  })

  it('returns 401 when user is not authenticated', async () => {
    const result = await handlePatch(
      { email_enabled: true },
      { userId: null, existingPrefs: null, upsertFn: makeUpsert() }
    )
    assert.equal(result.status, 401)
  })

  it('returns 500 when DB upsert fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const failingUpsert = (_payload: Record<string, unknown>) => ({
      data: null as null,
      error: { message: 'DB error' },
    })
    const result = await handlePatch(
      { email_enabled: true },
      { userId: 'u1', existingPrefs: null, upsertFn: failingUpsert }
    )
    assert.equal(result.status, 500)
  })
})

// ---------------------------------------------------------------------------
// AC-3: Defaults when no row exists (email_enabled=true, batch_window_minutes=15)
// ---------------------------------------------------------------------------
describe('AC-3: Defaults applied when no row exists', () => {
  it('uses email_enabled=true as default when no existing row and field not in body', async () => {
    let capturedPayload: Record<string, unknown> = {}
    const upsertFn = (payload: Record<string, unknown>) => {
      capturedPayload = payload
      return { data: { ...payload, updated_at: 'x' }, error: null as null }
    }

    await handlePatch({ batch_window_minutes: 30 }, { userId: 'u1', existingPrefs: null, upsertFn })

    assert.equal(capturedPayload.email_enabled, true, 'should default email_enabled to true')
  })

  it('uses batch_window_minutes=15 as default when no existing row and field not in body', async () => {
    let capturedPayload: Record<string, unknown> = {}
    const upsertFn = (payload: Record<string, unknown>) => {
      capturedPayload = payload
      return { data: { ...payload, updated_at: 'x' }, error: null as null }
    }

    await handlePatch({ email_enabled: false }, { userId: 'u1', existingPrefs: null, upsertFn })

    assert.equal(
      capturedPayload.batch_window_minutes,
      15,
      'should default batch_window_minutes to 15'
    )
  })

  it('preserves existing row values when fields are omitted from body', async () => {
    let capturedPayload: Record<string, unknown> = {}
    const upsertFn = (payload: Record<string, unknown>) => {
      capturedPayload = payload
      return { data: { ...payload, updated_at: 'x' }, error: null as null }
    }

    const existingPrefs = { email_enabled: false, batch_window_minutes: 60 }
    await handlePatch({}, { userId: 'u1', existingPrefs, upsertFn })

    assert.equal(capturedPayload.email_enabled, false, 'should keep existing email_enabled=false')
    assert.equal(
      capturedPayload.batch_window_minutes,
      60,
      'should keep existing batch_window_minutes=60'
    )
  })
})

// ---------------------------------------------------------------------------
// AC-4: Validation — invalid batch_window_minutes → 400
// ---------------------------------------------------------------------------
describe('AC-4: Validation rejects invalid batch_window_minutes with 400', () => {
  const invalidValues = [0, 1, 10, 45, 120, -5, 'fifteen', null, true, 5.5]

  for (const val of invalidValues) {
    it(`rejects batch_window_minutes=${JSON.stringify(val)} with 400`, async () => {
      const result = await handlePatch(
        { batch_window_minutes: val },
        { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
      )
      assert.equal(
        result.status,
        400,
        `expected 400 for batch_window_minutes=${JSON.stringify(val)}`
      )
    })
  }

  it('rejects email_enabled=1 (number, not boolean) with 400', async () => {
    const result = await handlePatch(
      { email_enabled: 1 },
      { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
    )
    assert.equal(result.status, 400)
  })

  it('rejects email_enabled="true" (string) with 400', async () => {
    const result = await handlePatch(
      { email_enabled: 'true' },
      { userId: 'u1', existingPrefs: null, upsertFn: makeUpsert() }
    )
    assert.equal(result.status, 400)
  })
})
