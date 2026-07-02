import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { redactSecretUrl, scrubSentryEvent } from './sentry-scrub.js'

const GUEST_TOKEN = 'a'.repeat(64)

describe('lib/sentry-scrub — redactSecretUrl', () => {
  it('redacts the token segment in /api/guest/<token>', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/api/guest/${GUEST_TOKEN}`),
      'https://hudo.app/api/guest/[redacted]'
    )
  })

  it('redacts the token segment in /api/guest/<token>/playback-url (keeps suffix)', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/api/guest/${GUEST_TOKEN}/playback-url`),
      'https://hudo.app/api/guest/[redacted]/playback-url'
    )
  })

  it('redacts the /guest/<token> page URL', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/guest/${GUEST_TOKEN}`),
      'https://hudo.app/guest/[redacted]'
    )
  })

  it('redacts the /auth/invite/<token> page URL', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/auth/invite/${GUEST_TOKEN}`),
      'https://hudo.app/auth/invite/[redacted]'
    )
  })

  it('redacts token query params (/api/invitations/validate?token=...)', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/api/invitations/validate?token=${GUEST_TOKEN}`),
      'https://hudo.app/api/invitations/validate?token=[redacted]'
    )
  })

  it('redacts token query params in non-first position', () => {
    assert.equal(
      redactSecretUrl(`https://hudo.app/x?a=1&token=${GUEST_TOKEN}&b=2`),
      'https://hudo.app/x?a=1&token=[redacted]&b=2'
    )
  })

  it('leaves non-secret URLs untouched', () => {
    const url = 'https://hudo.app/api/videos/123/playback-url?version=2'
    assert.equal(redactSecretUrl(url), url)
  })
})

describe('lib/sentry-scrub — scrubSentryEvent', () => {
  function makeEvent() {
    return {
      message: 'boom',
      request: {
        url: `https://hudo.app/api/guest/${GUEST_TOKEN}/playback-url`,
        method: 'GET',
        query_string: `token=${GUEST_TOKEN}`,
        cookies: { 'sb-access-token': 'secret-session-jwt' },
        data: { password: 'hunter2', token: GUEST_TOKEN },
        headers: {
          Cookie: 'sb-access-token=secret-session-jwt',
          cookie: 'sb-access-token=secret-session-jwt',
          Authorization: 'Bearer secret',
          authorization: 'Bearer secret',
          Referer: `https://hudo.app/guest/${GUEST_TOKEN}`,
          'user-agent': 'Mozilla/5.0',
          host: 'hudo.app',
        } as Record<string, unknown>,
      },
    }
  }

  it('drops cookies entirely', () => {
    const event = scrubSentryEvent(makeEvent())
    assert.ok(event)
    assert.equal(event.request.cookies, undefined)
    assert.ok(!('cookies' in event.request))
  })

  it('drops the request body (data) entirely', () => {
    const event = scrubSentryEvent(makeEvent())
    assert.ok(event)
    assert.ok(!('data' in event.request))
  })

  it('drops the raw query string', () => {
    const event = scrubSentryEvent(makeEvent())
    assert.ok(event)
    assert.ok(!('query_string' in event.request))
  })

  it('drops cookie/authorization/referer headers in any casing, keeps benign headers', () => {
    const event = scrubSentryEvent(makeEvent())
    assert.ok(event)
    const headers = event.request.headers
    assert.ok(!('Cookie' in headers))
    assert.ok(!('cookie' in headers))
    assert.ok(!('Authorization' in headers))
    assert.ok(!('authorization' in headers))
    assert.ok(!('Referer' in headers))
    assert.equal(headers['user-agent'], 'Mozilla/5.0')
    assert.equal(headers.host, 'hudo.app')
  })

  it('redacts the guest token from request.url', () => {
    const event = scrubSentryEvent(makeEvent())
    assert.ok(event)
    assert.equal(event.request.url, 'https://hudo.app/api/guest/[redacted]/playback-url')
  })

  it('no secret survives anywhere in the serialized event', () => {
    const event = scrubSentryEvent(makeEvent())
    const serialized = JSON.stringify(event)
    assert.ok(!serialized.includes(GUEST_TOKEN), 'guest token must not survive')
    assert.ok(!serialized.includes('secret-session-jwt'), 'session cookie must not survive')
    assert.ok(!serialized.includes('hunter2'), 'password must not survive')
    assert.ok(!serialized.includes('Bearer secret'), 'authorization header must not survive')
  })

  it('passes through events without a request context', () => {
    const event = { message: 'no request here', request: undefined }
    assert.deepEqual(scrubSentryEvent(event), { message: 'no request here', request: undefined })
  })

  it('tolerates missing headers / non-string url', () => {
    const event = { request: { url: 42, headers: undefined } }
    assert.doesNotThrow(() => scrubSentryEvent(event as never))
  })

  it('never throws on a frozen request — strips request context instead', () => {
    // In strict mode (ESM), `delete` on a frozen object throws TypeError; the
    // scrubber must catch it and fail safe by removing the request entirely.
    const event = {
      message: 'boom',
      request: Object.freeze({
        url: `https://hudo.app/api/guest/${GUEST_TOKEN}`,
        cookies: { 'sb-access-token': 'secret-session-jwt' },
      }),
    }
    let result: unknown
    assert.doesNotThrow(() => {
      result = scrubSentryEvent(event as never)
    })
    assert.ok(!JSON.stringify(result).includes(GUEST_TOKEN))
    assert.ok(!JSON.stringify(result).includes('secret-session-jwt'))
  })

  it('drops the event entirely (null) when even stripping is impossible', () => {
    const event = Object.freeze({
      message: 'boom',
      request: Object.freeze({
        cookies: { 'sb-access-token': 'secret-session-jwt' },
      }),
    })
    let result: unknown = 'sentinel'
    assert.doesNotThrow(() => {
      result = scrubSentryEvent(event as never)
    })
    assert.equal(result, null, 'losing the event is better than leaking the token')
  })
})

describe('lib/sentry-scrub — instrumentation wiring', () => {
  it('instrumentation.ts wires scrubSentryEvent as beforeSend for both runtimes', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.resolve(__dirname, '../instrumentation.ts'), 'utf8')

    assert.match(source, /import \{ scrubSentryEvent \} from '@\/lib\/sentry-scrub'/)
    const wirings = source.match(/beforeSend:\s*scrubSentryEvent/g) ?? []
    assert.equal(
      wirings.length,
      2,
      'both the nodejs and edge Sentry.init calls must wire beforeSend: scrubSentryEvent'
    )
  })
})
