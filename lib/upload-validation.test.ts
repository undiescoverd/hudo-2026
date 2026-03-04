/**
 * Unit tests for upload validation functions and constants.
 *
 * Run: npx tsx --test lib/upload-validation.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALLOWED_CONTENT_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MULTIPART_PART_SIZE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PRESIGNED_URL_EXPIRY,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW,
  calculatePartCount,
  generateR2Key,
  isMultipart,
  validateContentType,
  validateFileName,
  validateFileSize,
} from './upload-validation'

describe('constants', () => {
  it('allows only MP4 and QuickTime content types', () => {
    assert.deepEqual([...ALLOWED_CONTENT_TYPES], ['video/mp4', 'video/quicktime'])
  })

  it('allows only .mp4 and .mov extensions', () => {
    assert.deepEqual([...ALLOWED_EXTENSIONS], ['.mp4', '.mov'])
  })

  it('max file size is 10 GB', () => {
    assert.equal(MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024 * 1024)
  })

  it('multipart threshold is 50 MB', () => {
    assert.equal(MULTIPART_THRESHOLD_BYTES, 50 * 1024 * 1024)
  })

  it('multipart part size is 10 MB', () => {
    assert.equal(MULTIPART_PART_SIZE_BYTES, 10 * 1024 * 1024)
  })

  it('rate limit is 10 presigns per hour', () => {
    assert.equal(UPLOAD_RATE_LIMIT, 10)
    assert.equal(UPLOAD_RATE_WINDOW, 3600)
  })

  it('presigned URL expires in 1 hour', () => {
    assert.equal(PRESIGNED_URL_EXPIRY, 3600)
  })
})

describe('validateContentType', () => {
  it('accepts video/mp4', () => {
    assert.equal(validateContentType('video/mp4'), null)
  })

  it('accepts video/quicktime', () => {
    assert.equal(validateContentType('video/quicktime'), null)
  })

  it('rejects video/webm', () => {
    const err = validateContentType('video/webm')
    assert.ok(err)
    assert.match(err, /Invalid content type/)
  })

  it('rejects image/png', () => {
    const err = validateContentType('image/png')
    assert.ok(err)
    assert.match(err, /Invalid content type/)
  })

  it('rejects empty string', () => {
    assert.ok(validateContentType(''))
  })
})

describe('validateFileSize', () => {
  it('accepts 1 byte', () => {
    assert.equal(validateFileSize(1), null)
  })

  it('accepts exactly 10 GB', () => {
    assert.equal(validateFileSize(MAX_FILE_SIZE_BYTES), null)
  })

  it('rejects 10 GB + 1 byte', () => {
    const err = validateFileSize(MAX_FILE_SIZE_BYTES + 1)
    assert.ok(err)
    assert.match(err, /exceeds maximum/)
  })

  it('rejects 0 bytes', () => {
    const err = validateFileSize(0)
    assert.ok(err)
    assert.match(err, /positive number/)
  })

  it('rejects negative size', () => {
    const err = validateFileSize(-100)
    assert.ok(err)
    assert.match(err, /positive number/)
  })

  it('rejects NaN', () => {
    const err = validateFileSize(NaN)
    assert.ok(err)
    assert.match(err, /positive number/)
  })

  it('rejects Infinity', () => {
    const err = validateFileSize(Infinity)
    assert.ok(err)
    assert.match(err, /positive number/)
  })
})

describe('validateFileName', () => {
  it('accepts file.mp4', () => {
    assert.equal(validateFileName('file.mp4'), null)
  })

  it('accepts file.mov', () => {
    assert.equal(validateFileName('file.mov'), null)
  })

  it('accepts FILE.MP4 (case-insensitive extension)', () => {
    assert.equal(validateFileName('FILE.MP4'), null)
  })

  it('accepts file.MOV (case-insensitive extension)', () => {
    assert.equal(validateFileName('file.MOV'), null)
  })

  it('rejects file.avi', () => {
    const err = validateFileName('file.avi')
    assert.ok(err)
    assert.match(err, /Invalid file extension/)
  })

  it('rejects empty string', () => {
    const err = validateFileName('')
    assert.ok(err)
    assert.match(err, /required/)
  })

  it('rejects whitespace-only', () => {
    const err = validateFileName('   ')
    assert.ok(err)
    assert.match(err, /required/)
  })
})

describe('generateR2Key', () => {
  it('returns key in format {agencyId}/{videoId}/{uuid}.{ext}', () => {
    const key = generateR2Key('agency-123', 'video-456', 'my-video.mp4')
    assert.match(key, /^agency-123\/video-456\/[0-9a-f-]+\.mp4$/)
  })

  it('preserves .mov extension', () => {
    const key = generateR2Key('a', 'v', 'clip.MOV')
    assert.match(key, /\.mov$/)
  })

  it('generates unique keys on repeated calls', () => {
    const key1 = generateR2Key('a', 'v', 'f.mp4')
    const key2 = generateR2Key('a', 'v', 'f.mp4')
    assert.notEqual(key1, key2)
  })
})

describe('isMultipart', () => {
  it('returns false for files <= 50 MB', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES), false)
    assert.equal(isMultipart(1), false)
  })

  it('returns true for files > 50 MB', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES + 1), true)
  })
})

describe('calculatePartCount', () => {
  it('returns 1 for a file exactly 10 MB', () => {
    assert.equal(calculatePartCount(MULTIPART_PART_SIZE_BYTES), 1)
  })

  it('returns 2 for a file just over 10 MB', () => {
    assert.equal(calculatePartCount(MULTIPART_PART_SIZE_BYTES + 1), 2)
  })

  it('returns 10 for a 100 MB file', () => {
    assert.equal(calculatePartCount(100 * 1024 * 1024), 10)
  })

  it('returns correct count for a 1 GB file', () => {
    assert.equal(calculatePartCount(1024 * 1024 * 1024), Math.ceil(1024 / 10))
  })
})
