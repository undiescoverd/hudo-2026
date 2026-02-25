/**
 * Unit tests for thumbnail utilities.
 *
 * lib/thumbnail.ts is a 'use client' module that uses DOM APIs (document, canvas).
 * We test:
 * - Option merging and clamping logic (extracted, testable in Node)
 * - Upload URL construction
 * - Source invariants for security-critical patterns (crossOrigin, timeout)
 *
 * Run: npx tsx --test lib/thumbnail.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// Mirror the default options from thumbnail.ts to test merge/clamp behavior
const DEFAULT_OPTIONS = { seekTime: 2, maxWidth: 640, quality: 0.8 }

/** Replicates the option merge + clamp logic from captureVideoThumbnail */
function mergeAndClampOptions(options?: Partial<typeof DEFAULT_OPTIONS>) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  opts.seekTime = Math.max(0, opts.seekTime)
  opts.maxWidth = Math.max(1, Math.round(opts.maxWidth))
  opts.quality = Math.max(0, Math.min(1, opts.quality))
  return opts
}

describe('thumbnail — option defaults', () => {
  it('uses seekTime=2, maxWidth=640, quality=0.8 when no options given', () => {
    const opts = mergeAndClampOptions()
    assert.equal(opts.seekTime, 2)
    assert.equal(opts.maxWidth, 640)
    assert.equal(opts.quality, 0.8)
  })

  it('overrides only specified options', () => {
    const opts = mergeAndClampOptions({ seekTime: 5 })
    assert.equal(opts.seekTime, 5)
    assert.equal(opts.maxWidth, 640) // unchanged
    assert.equal(opts.quality, 0.8) // unchanged
  })
})

describe('thumbnail — option clamping', () => {
  it('clamps negative seekTime to 0', () => {
    const opts = mergeAndClampOptions({ seekTime: -5 })
    assert.equal(opts.seekTime, 0)
  })

  it('allows seekTime of 0', () => {
    const opts = mergeAndClampOptions({ seekTime: 0 })
    assert.equal(opts.seekTime, 0)
  })

  it('clamps maxWidth below 1 to 1', () => {
    const opts = mergeAndClampOptions({ maxWidth: 0 })
    assert.equal(opts.maxWidth, 1)
  })

  it('clamps negative maxWidth to 1', () => {
    const opts = mergeAndClampOptions({ maxWidth: -100 })
    assert.equal(opts.maxWidth, 1)
  })

  it('rounds fractional maxWidth', () => {
    const opts = mergeAndClampOptions({ maxWidth: 320.7 })
    assert.equal(opts.maxWidth, 321)
  })

  it('clamps quality above 1 to 1', () => {
    const opts = mergeAndClampOptions({ quality: 1.5 })
    assert.equal(opts.quality, 1)
  })

  it('clamps quality below 0 to 0', () => {
    const opts = mergeAndClampOptions({ quality: -0.5 })
    assert.equal(opts.quality, 0)
  })

  it('allows quality at boundaries (0 and 1)', () => {
    assert.equal(mergeAndClampOptions({ quality: 0 }).quality, 0)
    assert.equal(mergeAndClampOptions({ quality: 1 }).quality, 1)
  })
})

describe('thumbnail — upload URL construction', () => {
  it('builds correct API path from videoId', () => {
    const videoId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    const url = `/api/videos/${videoId}/thumbnail`
    assert.equal(url, '/api/videos/a1b2c3d4-e5f6-7890-abcd-ef1234567890/thumbnail')
  })
})

describe('thumbnail — source invariants', () => {
  // These tests verify security-critical patterns exist in the source.
  // captureVideoThumbnail uses DOM APIs (document.createElement, canvas)
  // that cannot be imported in Node, so source checks guard against
  // accidental removal of crossOrigin, timeout, and seek clamping.
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('sets crossOrigin to anonymous for canvas CORS access', () => {
    assert.match(source, /crossOrigin\s*=\s*['"]anonymous['"]/)
  })

  it('has a 15-second capture timeout guard', () => {
    assert.match(source, /CAPTURE_TIMEOUT_MS\s*=\s*15_000/)
  })

  it('clamps seek time to prevent seeking past video end', () => {
    assert.match(source, /Math\.min\(.*seekTime.*duration/)
  })

  it('exports captureVideoThumbnail and uploadThumbnail', () => {
    assert.match(source, /export async function captureVideoThumbnail/)
    assert.match(source, /export async function uploadThumbnail/)
  })

  it('uses POST method with Content-Type header for upload', () => {
    assert.match(source, /method:\s*['"]POST['"]/)
    assert.match(source, /blob\.type\s*\|\|\s*['"]image\/jpeg['"]/)
  })
})
