/**
 * Unit tests for the useUpload hook.
 *
 * Tests pure helper functions and source code invariants.
 * Uses Node.js built-in test runner — no browser runtime needed.
 *
 * Run: npx tsx --test hooks/useUpload.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getContentType, isQuotaError } from './useUpload'

const source = readFileSync(resolve(import.meta.dirname ?? __dirname, 'useUpload.ts'), 'utf8')

// Minimal File-like stub — getContentType only reads file.name
function fakeFile(name: string): File {
  return { name } as unknown as File
}

describe('getContentType', () => {
  it('returns video/mp4 for .mp4', () => {
    assert.equal(getContentType(fakeFile('clip.mp4')), 'video/mp4')
  })

  it('returns video/mp4 for uppercase .MP4', () => {
    assert.equal(getContentType(fakeFile('clip.MP4')), 'video/mp4')
  })

  it('returns video/quicktime for .mov', () => {
    assert.equal(getContentType(fakeFile('clip.mov')), 'video/quicktime')
  })

  it('returns video/quicktime for uppercase .MOV', () => {
    assert.equal(getContentType(fakeFile('clip.MOV')), 'video/quicktime')
  })

  it('returns null for .avi', () => {
    assert.equal(getContentType(fakeFile('clip.avi')), null)
  })

  it('returns null for .webm', () => {
    assert.equal(getContentType(fakeFile('clip.webm')), null)
  })

  it('returns null for no extension', () => {
    assert.equal(getContentType(fakeFile('noextension')), null)
  })
})

describe('isQuotaError', () => {
  it('returns true for 402', () => {
    assert.equal(isQuotaError(402), true)
  })

  it('returns false for 400', () => {
    assert.equal(isQuotaError(400), false)
  })

  it('returns false for 403', () => {
    assert.equal(isQuotaError(403), false)
  })

  it('returns false for 429', () => {
    assert.equal(isQuotaError(429), false)
  })

  it('returns false for 500', () => {
    assert.equal(isQuotaError(500), false)
  })
})

describe('useUpload source code invariants', () => {
  it('uses XMLHttpRequest for upload progress', () => {
    assert.match(source, /XMLHttpRequest/)
  })

  it('calls /api/videos/upload/presign', () => {
    assert.match(source, /upload\/presign/)
  })

  it('calls /api/videos/upload/complete', () => {
    assert.match(source, /upload\/complete/)
  })

  it('calls /api/videos/upload/multipart-url', () => {
    assert.match(source, /upload\/multipart-url/)
  })

  it('exports useUpload', () => {
    assert.match(source, /export function useUpload/)
  })

  it('exports getContentType', () => {
    assert.match(source, /export function getContentType/)
  })

  it('exports isQuotaError', () => {
    assert.match(source, /export function isQuotaError/)
  })
})
