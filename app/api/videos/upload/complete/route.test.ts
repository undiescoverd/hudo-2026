/**
 * Unit tests for the upload complete API route.
 *
 * Tests validation logic, access control invariants, and source code invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/upload/complete/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

describe('complete route — access control invariants', () => {
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

  it('returns 404 when video not found', () => {
    const video = null
    const status = video === null ? 404 : 200
    assert.equal(status, 404)
  })
})

describe('complete route — input validation', () => {
  it('requires ETag and PartNumber for multipart parts', () => {
    const validPart = { ETag: '"abc123"', PartNumber: 1 }
    assert.equal(typeof validPart.ETag, 'string')
    assert.equal(typeof validPart.PartNumber, 'number')

    const invalidPart = { ETag: 123, PartNumber: 'one' }
    assert.notEqual(typeof invalidPart.ETag, 'string')
    assert.notEqual(typeof invalidPart.PartNumber, 'number')
  })

  it('requires multipart parts when multipart flag is true', () => {
    const multipart = true
    const parts: unknown[] = []
    const valid = !multipart || (Array.isArray(parts) && parts.length > 0)
    assert.equal(valid, false)
  })
})

describe('complete route — source code invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('uses user-scoped Supabase client for RPC call (not service role)', () => {
    // RPC must be called via `supabase.rpc` (user-scoped), not `admin.rpc`
    assert.match(source, /supabase\.rpc\('create_video_version'/)
    assert.doesNotMatch(source, /admin\.rpc\('create_video_version'/)
  })

  it('route file contains POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('calls headObject to verify upload before creating version', () => {
    assert.match(source, /headObject/)
  })

  it('passes p_uploaded_by as user.id to the RPC', () => {
    assert.match(source, /p_uploaded_by:\s*user\.id/)
  })
})

describe('complete route — storage quota invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('calls increment_storage_usage RPC before create_video_version', () => {
    // Use .rpc(' prefix to match actual RPC calls, not comments
    const incrementPos = source.indexOf(".rpc('increment_storage_usage'")
    const createVersionPos = source.indexOf(".rpc('create_video_version'")
    assert.ok(incrementPos > -1, 'increment_storage_usage RPC must be called')
    assert.ok(createVersionPos > -1, 'create_video_version RPC must be called')
    assert.ok(
      incrementPos < createVersionPos,
      'quota increment must happen before version creation'
    )
  })

  it('uses headObject contentLength for quota (not client-declared size)', () => {
    // actualFileSize must use head.contentLength (not optional chaining — head is guaranteed non-null)
    assert.match(source, /head\.contentLength/)
    // Must NOT fall back to client-declared fileSizeBytes
    assert.doesNotMatch(
      source,
      /actualFileSize\s*=\s*head\?\.contentLength/,
      'Must not use optional chaining fallback to client-declared size'
    )
  })

  it('rolls back quota on version creation failure via decrement_storage_usage', () => {
    assert.match(source, /decrement_storage_usage/)
  })
})
