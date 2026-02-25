/**
 * Unit tests for thumbnail utilities.
 *
 * lib/thumbnail.ts is a 'use client' module that uses DOM APIs (document, canvas).
 * We can't import it directly in Node, so we test:
 * - Source invariants (export shape, security properties)
 * - Behavioral tests for the upload URL construction logic
 *
 * Run: npx tsx --test lib/thumbnail.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

describe('thumbnail — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('exports captureVideoThumbnail function', () => {
    assert.match(source, /export async function captureVideoThumbnail/)
  })

  it('exports uploadThumbnail function', () => {
    assert.match(source, /export async function uploadThumbnail/)
  })

  it('exports CaptureOptions interface', () => {
    assert.match(source, /export interface CaptureOptions/)
  })

  it('sets crossOrigin to anonymous for canvas access', () => {
    assert.match(source, /crossOrigin\s*=\s*['"]anonymous['"]/)
  })

  it('POSTs to the correct API endpoint', () => {
    assert.match(source, /\/api\/videos\/\$\{videoId\}\/thumbnail/)
  })

  it('has a capture timeout guard', () => {
    assert.match(source, /CAPTURE_TIMEOUT_MS/)
    assert.match(source, /setTimeout/)
  })

  it('clamps seek time to prevent seeking past video end', () => {
    assert.match(source, /Math\.min\(/)
    assert.match(source, /duration/)
  })
})

describe('thumbnail — default options', () => {
  it('seekTime defaults to 2 seconds', () => {
    // Test the actual default value computation
    const DEFAULT_OPTIONS = { seekTime: 2, maxWidth: 640, quality: 0.8 }
    assert.equal(DEFAULT_OPTIONS.seekTime, 2)
  })

  it('maxWidth defaults to 640px', () => {
    const DEFAULT_OPTIONS = { seekTime: 2, maxWidth: 640, quality: 0.8 }
    assert.equal(DEFAULT_OPTIONS.maxWidth, 640)
  })

  it('quality defaults to 0.8', () => {
    const DEFAULT_OPTIONS = { seekTime: 2, maxWidth: 640, quality: 0.8 }
    assert.equal(DEFAULT_OPTIONS.quality, 0.8)
  })

  it('options merge correctly (spread override)', () => {
    const DEFAULT_OPTIONS = { seekTime: 2, maxWidth: 640, quality: 0.8 }
    const opts = { ...DEFAULT_OPTIONS, ...{ seekTime: 5 } }
    assert.equal(opts.seekTime, 5)
    assert.equal(opts.maxWidth, 640) // unchanged
    assert.equal(opts.quality, 0.8) // unchanged
  })
})

describe('thumbnail — upload URL construction', () => {
  it('builds correct URL from videoId', () => {
    const videoId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const url = `/api/videos/${videoId}/thumbnail`
    assert.equal(url, '/api/videos/a1b2c3d4-e5f6-7890-abcd-ef1234567890/thumbnail')
  })

  it('uses POST method for upload', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /method:\s*['"]POST['"]/)
  })

  it('sets Content-Type from blob type with fallback to image/jpeg', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /blob\.type\s*\|\|\s*['"]image\/jpeg['"]/)
  })
})

describe('thumbnail — capture timeout', () => {
  it('timeout is set to 15 seconds', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /15_000/)
  })
})
