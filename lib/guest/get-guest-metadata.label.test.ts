/**
 * The agent-only guest link label must never reach a guest-facing path.
 * Calls the real getGuestMetadata with Supabase stubbed at fetch, where the
 * guest_links row carries a label, and asserts the label is absent from the result.
 */
import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.guest-label.test'
const realFetch = globalThis.fetch
const SECRET_LABEL = 'BBC casting, Sam'
let selects: string[] = []

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-guest-label-test'
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('getGuestMetadata does not leak the link label', () => {
  it('result excludes the label and the guest_links query never selects it', async () => {
    const { hashGuestToken } = await import('@/lib/guest-tokens')
    const { getGuestMetadata } = await import('./get-guest-metadata')
    const token = 'tok-guest-label'
    selects = []
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const one = (b: unknown) => Response.json(b)
      if (url.pathname === '/rest/v1/guest_links') {
        selects.push(url.searchParams.get('select') ?? '')
        return one({
          id: 'l1',
          video_id: 'v1',
          video_version_id: 'ver1',
          token_hash: hashGuestToken(token),
          expires_at: null,
          revoked_at: null,
          label: SECRET_LABEL, // a stub that over-returns must still not leak
        })
      }
      if (url.pathname === '/rest/v1/videos')
        return one({
          id: 'v1',
          title: 'T',
          description: null,
          status: 'in_review',
          active_version_id: 'ver1',
        })
      if (url.pathname === '/rest/v1/video_versions')
        return one({ id: 'ver1', version_number: 1, duration_seconds: 10 })
      if (url.pathname === '/rest/v1/comments') return one([])
      void init
      return Response.json({}, { status: 404 })
    }) as typeof fetch

    const meta = await getGuestMetadata(token)
    assert.ok(meta)
    assert.ok(!JSON.stringify(meta).includes(SECRET_LABEL))
    assert.ok(selects.length > 0)
    for (const s of selects) assert.ok(!s.includes('label'), `guest_links select: ${s}`)
  })
})
