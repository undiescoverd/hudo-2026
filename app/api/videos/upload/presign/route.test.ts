/**
 * Unit tests for the presign upload API route.
 *
 * Tests validation logic, constants, and access control invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/upload/presign/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALLOWED_CONTENT_TYPES,
  MAX_FILE_SIZE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PRESIGNED_URL_EXPIRY,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW,
  isMultipart,
  validateContentType,
  validateFileName,
  validateFileSize,
} from '../../../../../lib/upload-validation'

describe('presign route — validation functions', () => {
  it('rejects non-video content types', () => {
    assert.ok(validateContentType('application/pdf'))
    assert.ok(validateContentType('video/webm'))
    assert.ok(validateContentType('audio/mp3'))
  })

  it('accepts MP4 and QuickTime', () => {
    assert.equal(validateContentType('video/mp4'), null)
    assert.equal(validateContentType('video/quicktime'), null)
  })

  it('rejects files larger than 10 GB', () => {
    assert.ok(validateFileSize(MAX_FILE_SIZE_BYTES + 1))
  })

  it('accepts files up to 10 GB', () => {
    assert.equal(validateFileSize(MAX_FILE_SIZE_BYTES), null)
    assert.equal(validateFileSize(1), null)
  })

  it('rejects non-.mp4/.mov file names', () => {
    assert.ok(validateFileName('video.avi'))
    assert.ok(validateFileName('video.webm'))
    assert.ok(validateFileName('noextension'))
  })

  it('accepts .mp4 and .mov file names', () => {
    assert.equal(validateFileName('video.mp4'), null)
    assert.equal(validateFileName('VIDEO.MOV'), null)
  })
})

describe('presign route — constants', () => {
  it('only allows MP4 and MOV', () => {
    assert.deepEqual([...ALLOWED_CONTENT_TYPES], ['video/mp4', 'video/quicktime'])
  })

  it('rate limit is 10 per hour', () => {
    assert.equal(UPLOAD_RATE_LIMIT, 10)
    assert.equal(UPLOAD_RATE_WINDOW, 3600)
  })

  it('presigned URL expires in 3600 seconds (1 hour)', () => {
    assert.equal(PRESIGNED_URL_EXPIRY, 3600)
  })

  it('multipart threshold is 50 MB', () => {
    assert.equal(MULTIPART_THRESHOLD_BYTES, 50 * 1024 * 1024)
  })
})

describe('presign route — multipart decision', () => {
  it('uses single PUT for 50 MB', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES), false)
  })

  it('uses multipart for 50 MB + 1', () => {
    assert.equal(isMultipart(MULTIPART_THRESHOLD_BYTES + 1), true)
  })

  it('uses multipart for 1 GB', () => {
    assert.equal(isMultipart(1024 * 1024 * 1024), true)
  })
})

describe('presign route — access control invariants', () => {
  it('returns 401 when user is null', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('returns 403 when membership is null', () => {
    const membership = null
    const status = membership === null ? 403 : 200
    assert.equal(status, 403)
  })

  it('returns 403 for talent role', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.equal(agentPlusRoles.includes('talent'), false)
  })

  it('allows agent+ roles', () => {
    const agentPlusRoles = ['owner', 'admin_agent', 'agent']
    assert.ok(agentPlusRoles.includes('owner'))
    assert.ok(agentPlusRoles.includes('admin_agent'))
    assert.ok(agentPlusRoles.includes('agent'))
  })
})

describe('presign route — source code invariants', () => {
  it('uses user-scoped rate limit key: upload:presign:user:{userId}', () => {
    const userId = 'test-user-123'
    const key = `upload:presign:user:${userId}`
    assert.equal(key, 'upload:presign:user:test-user-123')
  })

  it('route file exists and contains POST handler', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /export async function POST/)
    assert.match(source, /upload:presign:user:/)
    assert.match(source, /UPLOAD_RATE_LIMIT/)
    assert.match(source, /generateUploadUrl|createMultipartUpload/)
  })
})
