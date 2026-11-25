/**
 * resolveGuestLink says why a link was rejected (expired / revoked / subscription /
 * not-found) so /guest/invalid can pick a generic heading; getGuestMetadata still
 * collapses every rejection to null for the API route. Supabase is stubbed at fetch.
 */
import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.guest-reason.test'
const realFetch = globalThis.fetch

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SB
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-guest-reason-test'
})
afterEach(() => {
  globalThis.fetch = realFetch
})

async function stub(token: string, link: Record<string, unknown> | null, subStatus = 'active') {
  const { hashGuestToken } = await import('@/lib/guest-tokens')
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.pathname === '/rest/v1/guest_links') {
      return Response.json(
        link && {
          id: 'l1',
          video_id: 'v1',
          agency_id: 'a1',
          video_version_id: 'ver1',
          token_hash: hashGuestToken(token),
          expires_at: null,
          revoked_at: null,
          ...link,
        }
      )
    }
    if (url.pathname === '/rest/v1/agencies')
      return Response.json({ subscription_status: subStatus })
    if (url.pathname === '/rest/v1/videos')
      return Response.json({ id: 'v1', title: 'T', active_version_id: 'ver1' })
    if (url.pathname === '/rest/v1/video_versions')
      return Response.json({ id: 'ver1', version_number: 1, duration_seconds: 5 })
    return Response.json(null, { status: 404 })
  }) as typeof fetch
}

describe('resolveGuestLink', () => {
  it('unknown token → not-found', async () => {
    const { resolveGuestLink } = await import('./get-guest-metadata')
    await stub('t', null)
    assert.deepEqual(await resolveGuestLink('t'), { ok: false, reason: 'not-found' })
  })
  it('revoked → revoked', async () => {
    const { resolveGuestLink } = await import('./get-guest-metadata')
    await stub('t', { revoked_at: '2026-01-01T00:00:00Z' })
    assert.deepEqual(await resolveGuestLink('t'), { ok: false, reason: 'revoked' })
  })
  it('past expiry → expired', async () => {
    const { resolveGuestLink } = await import('./get-guest-metadata')
    await stub('t', { expires_at: '2020-01-01T00:00:00Z' })
    assert.deepEqual(await resolveGuestLink('t'), { ok: false, reason: 'expired' })
  })
  it('ended subscription → subscription', async () => {
    const { resolveGuestLink } = await import('./get-guest-metadata')
    await stub('t', {}, 'canceled')
    assert.deepEqual(await resolveGuestLink('t'), { ok: false, reason: 'subscription' })
  })
  it('valid link → ok; getGuestMetadata returns the data, and null on rejection', async () => {
    const { resolveGuestLink, getGuestMetadata } = await import('./get-guest-metadata')
    await stub('t', {})
    assert.equal((await resolveGuestLink('t')).ok, true)
    assert.equal((await getGuestMetadata('t'))?.video.title, 'T')
    await stub('t', { revoked_at: '2026-01-01T00:00:00Z' })
    assert.equal(await getGuestMetadata('t'), null)
  })
})
