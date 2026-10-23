/**
 * Unit tests for the browser upload client (B1 request body, B2 retry reuse, B3 error messages).
 *
 * Run: npx tsx --test lib/upload-client.test.ts
 */

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  buildPresignBody,
  formatWait,
  isQuotaMessage,
  parseRetryAfterSeconds,
  performUpload,
  presignErrorMessage,
} from './upload-client'

const QUOTA_MSG = 'Storage quota exceeded. Please upgrade your plan or delete unused videos.'
const PAST_DUE_MSG = 'Your plan is past due — please update payment to continue uploading.'

interface Call {
  url: string
  body: Record<string, unknown>
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

const realFetch = globalThis.fetch
let calls: Call[] = []
let responder: (call: Call) => Response

function stubFetch() {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    }
    calls.push(call)
    return responder(call)
  }) as typeof fetch
}

const file = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' })
const presignCalls = () => calls.filter((c) => c.url === '/api/videos/upload/presign')

describe('performUpload', () => {
  beforeEach(stubFetch)
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('B2: reports the videoId and a retry sends it; presign is not called without it', async () => {
    let putShouldFail = true
    responder = (call) => {
      if (call.url === '/api/videos/upload/presign') {
        return jsonResponse(200, {
          videoId: 'vid-1',
          r2Key: 'k',
          multipart: false,
          uploadUrl: 'https://r2.example/put',
        })
      }
      return jsonResponse(200, { videoId: 'vid-1' })
    }
    const putSingle = async () => {
      if (putShouldFail) throw new Error('Network error during upload')
    }

    let draft: string | undefined
    const run = () =>
      performUpload(file, {
        agencyId: 'ag-1',
        onProgress: () => {},
        videoId: draft,
        onVideoId: (id) => {
          draft = id
        },
        putSingle,
      })

    await assert.rejects(run(), /Network error/)
    assert.equal(draft, 'vid-1', 'videoId is reported even though the PUT failed')
    assert.equal('videoId' in presignCalls()[0].body, false, 'first presign has no videoId')

    putShouldFail = false
    const result = await run()
    assert.equal(result, 'vid-1')
    assert.equal(presignCalls().length, 2)
    assert.equal(presignCalls()[1].body.videoId, 'vid-1', 'retry reuses the first presign videoId')
  })

  it('B1: agent request body includes talentId', async () => {
    responder = () => jsonResponse(402, { error: QUOTA_MSG })
    await assert.rejects(
      performUpload(file, { agencyId: 'ag-1', talentId: 'talent-9', onProgress: () => {} })
    )
    assert.equal(presignCalls()[0].body.talentId, 'talent-9')
  })

  it('B1: talent request body has no talentId key', async () => {
    responder = () => jsonResponse(402, { error: QUOTA_MSG })
    await assert.rejects(performUpload(file, { agencyId: 'ag-1', onProgress: () => {} }))
    assert.equal('talentId' in presignCalls()[0].body, false)
    assert.equal('videoId' in presignCalls()[0].body, false)
  })

  it('B3: 402 quota and 402 past-due messages pass through verbatim', async () => {
    responder = () => jsonResponse(402, { error: QUOTA_MSG })
    await assert.rejects(performUpload(file, { agencyId: 'a', onProgress: () => {} }), {
      message: QUOTA_MSG,
    })

    responder = () => jsonResponse(402, { error: PAST_DUE_MSG })
    await assert.rejects(performUpload(file, { agencyId: 'a', onProgress: () => {} }), {
      message: PAST_DUE_MSG,
    })
  })

  it('B3: 429 message includes the Retry-After wait', async () => {
    responder = () =>
      jsonResponse(
        429,
        { error: 'Too many upload requests. Please try again later.' },
        { 'Retry-After': '42' }
      )
    await assert.rejects(performUpload(file, { agencyId: 'a', onProgress: () => {} }), {
      message: 'Too many upload requests. Try again in 42 seconds.',
    })
  })
})

describe('presignErrorMessage', () => {
  it('formats minutes and hours', () => {
    assert.equal(
      presignErrorMessage(429, {}, '300'),
      'Too many upload requests. Try again in 5 minutes.'
    )
    assert.equal(
      presignErrorMessage(429, {}, '3600'),
      'Too many upload requests. Try again in 1 hour.'
    )
  })

  it('falls back gracefully when Retry-After is missing or invalid', () => {
    const fallback = 'Too many upload requests. Please try again later.'
    assert.equal(presignErrorMessage(429, {}, null), fallback)
    assert.equal(presignErrorMessage(429, {}, 'soon'), fallback)
    assert.equal(presignErrorMessage(429, {}, '0'), fallback)
  })

  it('passes the server error through, with a status fallback', () => {
    assert.equal(presignErrorMessage(400, { error: 'File too large' }, null), 'File too large')
    assert.equal(presignErrorMessage(500, {}, null), 'Presign failed: 500')
  })
})

describe('formatWait / parseRetryAfterSeconds', () => {
  it('formats units with correct pluralisation', () => {
    assert.equal(formatWait(1), '1 second')
    assert.equal(formatWait(59), '59 seconds')
    assert.equal(formatWait(60), '1 minute')
    assert.equal(formatWait(61), '2 minutes')
    assert.equal(formatWait(3900), '1 hour 5 minutes')
    assert.equal(formatWait(7200), '2 hours')
  })

  it('parses delta-seconds and HTTP-dates', () => {
    assert.equal(parseRetryAfterSeconds('42'), 42)
    const now = Date.parse('2026-01-01T00:00:00Z')
    assert.equal(parseRetryAfterSeconds('Thu, 01 Jan 2026 00:01:00 GMT', now), 60)
    assert.equal(parseRetryAfterSeconds(null), null)
  })
})

describe('isQuotaMessage', () => {
  it('is true only for the real quota message', () => {
    assert.equal(isQuotaMessage(QUOTA_MSG), true)
    assert.equal(isQuotaMessage(PAST_DUE_MSG), false)
    assert.equal(isQuotaMessage('Too many upload requests. Try again in 42 seconds.'), false)
    assert.equal(isQuotaMessage('Failed to verify storage quota'), false)
    assert.equal(isQuotaMessage(null), false)
  })
})

describe('buildPresignBody', () => {
  it('omits optional keys when unset', () => {
    const body = buildPresignBody({
      agencyId: 'a',
      fileName: 'f.mp4',
      contentType: 'video/mp4',
      fileSizeBytes: 1,
    })
    assert.deepEqual(Object.keys(body).sort(), [
      'agencyId',
      'contentType',
      'fileName',
      'fileSizeBytes',
    ])
  })
})
