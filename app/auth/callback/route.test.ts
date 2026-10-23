/**
 * Behavioural tests for GET /auth/callback — the real handler runs end to end.
 *
 * Supabase Auth is stubbed at the global fetch layer (PKCE `exchangeCodeForSession`
 * POSTs /auth/v1/token) and the call is wrapped in `requestAsyncStorage.run` so that
 * `cookies()` works. Focus: the `next` redirect target can never leave the request origin.
 *
 * Run: npx tsx --test app/auth/callback/route.test.ts
 */

import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import { afterEach, before, describe, it } from 'node:test'

const SB = 'https://sb.callback.test'
const ORIGIN = 'https://app.callback.test'
const VERIFIER = 'verifier-callback-test'
const USER_ID = '11111111-2222-4333-8444-555555555555'
const realFetch = globalThis.fetch

type Call = { method: string; url: URL; body: unknown }

describe('auth callback route — open-redirect guard', () => {
  let calls: Call[] = []
  let exchangeFails = false
  let GET: (req: NextRequest) => Promise<Response>
  let runInScope: <T>(fn: () => Promise<T>) => Promise<T>

  function installFetch() {
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      const method = (init.method ?? 'GET').toUpperCase()
      let body: unknown
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body)
        } catch {
          body = init.body
        }
      }
      calls.push({ method, url, body })
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        })

      if (url.origin === SB && url.pathname === '/auth/v1/token') {
        if (exchangeFails) {
          return json(400, { code: 400, error_code: 'bad_code_verifier', msg: 'invalid grant' })
        }
        return json(200, {
          access_token: 'access-callback-test',
          refresh_token: 'refresh-callback-test',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: USER_ID,
            aud: 'authenticated',
            role: 'authenticated',
            email: 'user@callback.test',
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        })
      }
      return json(404, { message: `unexpected ${method} ${url.pathname}` })
    }) as typeof fetch
  }

  before(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SB
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-callback-test'
    // Next's request-scope storage needs the global ALS that its server runtime normally installs.
    const { AsyncLocalStorage } = await import('node:async_hooks')
    ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage
    const { requestAsyncStorage } =
      await import('next/dist/client/components/request-async-storage.external')

    // PKCE code verifier cookie: without it exchangeCodeForSession fails before any network call.
    const cookieList = [{ name: 'sb-sb-auth-token-code-verifier', value: VERIFIER }]
    const cookies = { getAll: () => cookieList, set: () => {}, get: () => undefined }
    runInScope = (fn) =>
      requestAsyncStorage.run({ cookies, mutableCookies: cookies } as never, fn) as Promise<never>
    ;({ GET } = await import('./route'))
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function call(query: string, opts: { exchangeFails?: boolean } = {}) {
    calls = []
    exchangeFails = opts.exchangeFails ?? false
    installFetch()
    const req = new Request(`${ORIGIN}/auth/callback${query}`) as unknown as NextRequest
    return runInScope(() => GET(req))
  }

  const tokenCalls = () => calls.filter((c) => c.url.pathname === '/auth/v1/token')

  function location(res: Response): URL {
    const header = res.headers.get('location')
    assert.ok(header, 'redirect response must carry a Location header')
    return new URL(header)
  }

  it('exchanges the code (with the PKCE verifier) before redirecting', async () => {
    const res = await call('?code=x&next=/videos/abc')
    assert.equal(res.status, 307)
    assert.equal(tokenCalls().length, 1)
    assert.equal(tokenCalls()[0].method, 'POST')
    assert.equal(tokenCalls()[0].url.searchParams.get('grant_type'), 'pkce')
    assert.deepEqual(tokenCalls()[0].body, { auth_code: 'x', code_verifier: VERIFIER })
  })

  it('redirects to a safe local next path on the request origin', async () => {
    const res = await call('?code=x&next=/videos/abc')
    assert.equal(res.status, 307)
    assert.equal(location(res).href, `${ORIGIN}/videos/abc`)
  })

  it('keeps the query string of a safe next path', async () => {
    const res = await call(`?code=x&next=${encodeURIComponent('/videos/abc?t=30')}`)
    assert.equal(location(res).href, `${ORIGIN}/videos/abc?t=30`)
  })

  it('defaults to / when next is absent', async () => {
    const res = await call('?code=x')
    assert.equal(res.status, 307)
    assert.equal(location(res).href, `${ORIGIN}/`)
  })

  // Raw query values, as an attacker would send them. searchParams.get decodes %09/%0A/%5C, and
  // the URL parser then strips tabs/newlines and treats `\` as `/` — so the encoded and
  // backslash variants used to resolve to https://evil.com.
  for (const [label, next] of [
    ['encoded tab (/%09/evil.com)', '/%09/evil.com'],
    ['encoded newline (/%0A/evil.com)', '/%0A/evil.com'],
    ['encoded carriage return (/%0D/evil.com)', '/%0D/evil.com'],
    ['encoded backslash (/%5Cevil.com)', '/%5Cevil.com'],
    ['encoded backslash + slash (/%5C/evil.com)', '/%5C/evil.com'],
    ['literal backslash (/\\evil.com)', '/\\evil.com'],
    ['protocol-relative (//evil.com)', '//evil.com'],
    ['absolute URL (https://evil.com)', 'https://evil.com'],
    ['dot-dot whose path normalises to //evil.com (defence in depth)', '/..//evil.com'],
  ] as const) {
    it(`falls back to / on the request origin for ${label}`, async () => {
      const res = await call(`?code=x&next=${next}`)
      assert.equal(res.status, 307)
      const loc = location(res)
      assert.equal(loc.origin, ORIGIN)
      assert.equal(loc.pathname, '/')
      assert.equal(loc.search, '')
      assert.equal(tokenCalls().length, 1, 'the code is still exchanged; only the target changes')
    })
  }

  it('redirects to /auth/signin?error=auth when there is no code, without calling Supabase', async () => {
    const res = await call('?next=/videos/abc')
    assert.equal(res.status, 307)
    assert.equal(location(res).href, `${ORIGIN}/auth/signin?error=auth`)
    assert.equal(calls.length, 0)
  })

  it('redirects to /auth/signin?error=auth when the code exchange fails', async () => {
    const res = await call('?code=x&next=/videos/abc', { exchangeFails: true })
    assert.equal(res.status, 307)
    assert.equal(location(res).href, `${ORIGIN}/auth/signin?error=auth`)
    assert.equal(tokenCalls().length, 1)
  })
})
