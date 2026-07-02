import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminClient } from './supabase-admin.js'

describe('lib/supabase-admin — createAdminClient', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const ORIGINAL_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL

    if (ORIGINAL_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_KEY
  })

  it('throws a clear error when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    assert.throws(() => createAdminClient(), /NEXT_PUBLIC_SUPABASE_URL/)
  })

  it('throws a clear error when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    assert.throws(() => createAdminClient(), /SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('throws when both env vars are missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    assert.throws(() => createAdminClient())
  })

  describe('with valid env vars', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    })

    it('returns a Supabase client (does not throw)', () => {
      const client = createAdminClient()
      assert.ok(client)
      assert.equal(typeof client.from, 'function')
    })

    it('never persists a session and never auto-refreshes tokens', () => {
      const client = createAdminClient()
      // supabase-js exposes the resolved auth options on the internal auth client.
      const authAny = client.auth as unknown as {
        persistSession?: boolean
        autoRefreshToken?: boolean
      }
      assert.equal(authAny.persistSession, false)
      assert.equal(authAny.autoRefreshToken, false)
    })
  })
})
