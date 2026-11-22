/**
 * S5-FLOW-007: retries, abort on give-up, tab-close warning (behavioural).
 *
 * Run: npx tsx --test lib/upload-client.retry.test.ts
 */

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  UploadHttpError,
  abortMultipartUpload,
  attachBeforeUnloadGuard,
  isRetryableUploadError,
  performUpload,
  withRetry,
} from './upload-client'

const noSleep = async () => {}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const realFetch = globalThis.fetch
let urls: string[] = []

describe('withRetry', () => {
  it('succeeds on attempt 2 after a retryable failure, backing off once', async () => {
    let n = 0
    const sleeps: number[] = []
    const result = await withRetry(
      async () => {
        n++
        if (n === 1) throw new UploadHttpError('Part upload failed: 503', 503)
        return 'ok'
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, baseDelayMs: 100 }
    )
    assert.equal(result, 'ok')
    assert.equal(n, 2)
    assert.deepEqual(sleeps, [75]) // 100 * 2^0 * (0.5 + 0.5/2)
  })

  it('doubles the delay each attempt and gives up after 3 attempts with the real cause', async () => {
    let n = 0
    const sleeps: number[] = []
    await assert.rejects(
      withRetry(
        async () => {
          n++
          throw new UploadHttpError('Network error during upload')
        },
        { sleep: async (ms) => void sleeps.push(ms), random: () => 1, baseDelayMs: 100 }
      ),
      /Network error during upload \(gave up after 3 attempts\)/
    )
    assert.equal(n, 3)
    assert.deepEqual(sleeps, [100, 200])
  })

  it('does not retry non-retryable statuses (403, 404) or plain errors', async () => {
    for (const err of [
      new UploadHttpError('Part upload failed: 403', 403),
      new UploadHttpError('Upload failed: 404', 404),
      new Error('Part upload succeeded but ETag header was missing'),
    ]) {
      let n = 0
      await assert.rejects(
        withRetry(
          async () => {
            n++
            throw err
          },
          { sleep: noSleep }
        ),
        err
      )
      assert.equal(n, 1)
    }
  })

  it('classifies 408, 429, 5xx and fetch TypeErrors as retryable', () => {
    for (const s of [408, 429, 500, 502, 503]) {
      assert.equal(isRetryableUploadError(new UploadHttpError('x', s)), true, String(s))
    }
    assert.equal(isRetryableUploadError(new TypeError('Failed to fetch')), true)
    assert.equal(isRetryableUploadError(new UploadHttpError('x', 400)), false)
  })
})

describe('performUpload: retry and abort', () => {
  const bigFile = new File([new Uint8Array(10 * 1024 * 1024 + 10)], 'big.mp4', {
    type: 'video/mp4',
  })
  const smallFile = new File([new Uint8Array(10)], 'clip.mp4', { type: 'video/mp4' })
  const multipartPresign = {
    videoId: 'vid-1',
    r2Key: 'ag-1/vid-1/k.mp4',
    multipart: true,
    r2UploadId: 'up-1',
    partCount: 2,
    partUrls: [
      { partNumber: 1, url: 'https://r2.example/p1' },
      { partNumber: 2, url: 'https://r2.example/p2' },
    ],
  }
  const presignBodies: Record<string, unknown>[] = []

  /** Per-part-URL sequence of statuses; the last entry repeats. */
  function stubMultipart(partStatuses: Record<string, number[]>) {
    const hits: Record<string, number> = {}
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      if (url === '/api/videos/upload/presign') {
        presignBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return jsonResponse(200, multipartPresign)
      }
      if (url.startsWith('https://r2.example/')) {
        const seq = partStatuses[url] ?? [200]
        const status = seq[Math.min(hits[url] ?? 0, seq.length - 1)]
        hits[url] = (hits[url] ?? 0) + 1
        return new Response(null, { status, headers: status === 200 ? { ETag: '"abc"' } : {} })
      }
      return jsonResponse(200, { videoId: 'vid-1' })
    }) as typeof fetch
  }

  const count = (u: string) => urls.filter((x) => x === u).length

  beforeEach(() => {
    urls = []
    presignBodies.length = 0
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('retries a failed part on the same URL, then completes without aborting', async () => {
    stubMultipart({ 'https://r2.example/p2': [503, 200] })
    const aborted: string[][] = []
    const id = await performUpload(bigFile, {
      agencyId: 'ag-1',
      onProgress: () => {},
      retry: { sleep: noSleep },
      abortMultipart: async (k, u) => void aborted.push([k, u]),
    })
    assert.equal(id, 'vid-1')
    assert.equal(count('https://r2.example/p2'), 2)
    assert.equal(count('/api/videos/upload/presign'), 1, 'no extra presign while retrying')
    assert.equal(aborted.length, 0)
  })

  it('gives up after 3 attempts, aborts the multipart upload, and surfaces the real cause', async () => {
    stubMultipart({ 'https://r2.example/p2': [503] })
    const aborted: string[][] = []
    await assert.rejects(
      performUpload(bigFile, {
        agencyId: 'ag-1',
        onProgress: () => {},
        retry: { sleep: noSleep },
        abortMultipart: async (k, u) => void aborted.push([k, u]),
      }),
      /Part 2 upload failed: 503 \(gave up after 3 attempts\)/
    )
    assert.equal(count('https://r2.example/p2'), 3)
    assert.deepEqual(aborted, [['ag-1/vid-1/k.mp4', 'up-1']])
    assert.equal(count('/api/videos/upload/complete'), 0)
  })

  it('does not retry a 403 (expired signature) but still aborts', async () => {
    stubMultipart({ 'https://r2.example/p1': [403] })
    const aborted: string[][] = []
    await assert.rejects(
      performUpload(bigFile, {
        agencyId: 'ag-1',
        onProgress: () => {},
        retry: { sleep: noSleep },
        abortMultipart: async (k, u) => void aborted.push([k, u]),
      }),
      /Part 1 upload failed: 403$/
    )
    assert.equal(count('https://r2.example/p1'), 1)
    assert.equal(aborted.length, 1)
  })

  it('default abort POSTs to /api/videos/upload/abort and never throws', async () => {
    stubMultipart({ 'https://r2.example/p1': [403] })
    await assert.rejects(
      performUpload(bigFile, { agencyId: 'ag-1', onProgress: () => {}, retry: { sleep: noSleep } })
    )
    assert.equal(count('/api/videos/upload/abort'), 1)

    globalThis.fetch = (async () => {
      throw new TypeError('offline')
    }) as typeof fetch
    await abortMultipartUpload('k', 'u') // resolves
  })

  it('single PUT: retries a 5xx then succeeds; gives up with the real cause otherwise', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input) === '/api/videos/upload/presign'
        ? jsonResponse(200, {
            videoId: 'vid-1',
            r2Key: 'k',
            multipart: false,
            uploadUrl: 'https://r2.example/put',
          })
        : jsonResponse(200, { videoId: 'vid-1' })) as typeof fetch

    let n = 0
    const flaky = async () => {
      if (++n < 2) throw new UploadHttpError('Upload failed: 500', 500)
    }
    const id = await performUpload(smallFile, {
      agencyId: 'a',
      onProgress: () => {},
      putSingle: flaky,
      retry: { sleep: noSleep },
    })
    assert.equal(id, 'vid-1')
    assert.equal(n, 2)

    n = 0
    const dead = async () => {
      n++
      throw new UploadHttpError('Network error during upload')
    }
    await assert.rejects(
      performUpload(smallFile, {
        agencyId: 'a',
        onProgress: () => {},
        putSingle: dead,
        retry: { sleep: noSleep },
      }),
      /Network error during upload \(gave up after 3 attempts\)/
    )
    assert.equal(n, 3)
  })

  it('Retry after give-up reuses the draft video id (no second empty draft)', async () => {
    stubMultipart({ 'https://r2.example/p2': [503] })
    let draft: string | undefined
    const run = () =>
      performUpload(bigFile, {
        agencyId: 'ag-1',
        onProgress: () => {},
        videoId: draft,
        onVideoId: (id) => {
          draft = id
        },
        retry: { sleep: noSleep },
        abortMultipart: async () => {},
      })
    await assert.rejects(run())
    await assert.rejects(run())
    assert.equal(presignBodies.length, 2)
    assert.equal('videoId' in presignBodies[0], false)
    assert.equal(presignBodies[1].videoId, 'vid-1')
  })
})

describe('attachBeforeUnloadGuard', () => {
  it('prompts on beforeunload while attached and stops after cleanup', () => {
    const target = new EventTarget()
    const remove = attachBeforeUnloadGuard(target as unknown as Window)
    const event = new Event('beforeunload', { cancelable: true })
    target.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)

    remove()
    const after = new Event('beforeunload', { cancelable: true })
    target.dispatchEvent(after)
    assert.equal(after.defaultPrevented, false)
  })
})
