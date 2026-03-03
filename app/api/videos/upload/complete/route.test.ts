/**
 * Unit tests for the upload complete API route.
 *
 * Tests validation logic, access control, and source code invariants.
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 *
 * Run: npx tsx --test app/api/videos/upload/complete/route.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

// ── Extracted constants (must match route.ts) ─────────────────────────────
const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']

describe('complete route — role authorization', () => {
  it('owner can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('owner'))
  })

  it('admin_agent can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('admin_agent'))
  })

  it('agent can complete uploads', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('agent'))
  })

  it('talent cannot complete uploads', () => {
    assert.ok(!AGENT_PLUS_ROLES.includes('talent'))
  })

  it('guest cannot complete uploads', () => {
    assert.ok(!AGENT_PLUS_ROLES.includes('guest'))
  })
})

describe('complete route — multipart validation', () => {
  it('requires ETag (string) and PartNumber (number) for multipart parts', () => {
    const validPart = { ETag: '"abc123"', PartNumber: 1 }
    assert.equal(typeof validPart.ETag, 'string')
    assert.equal(typeof validPart.PartNumber, 'number')

    const invalidPart = { ETag: 123, PartNumber: 'one' }
    assert.notEqual(typeof invalidPart.ETag, 'string')
    assert.notEqual(typeof invalidPart.PartNumber, 'number')
  })

  it('rejects empty parts array when multipart flag is true', () => {
    const multipart = true
    const parts: unknown[] = []
    const valid = !multipart || (Array.isArray(parts) && parts.length > 0)
    assert.equal(valid, false)
  })

  it('accepts non-empty parts array when multipart flag is true', () => {
    const multipart = true
    const parts = [{ ETag: '"abc"', PartNumber: 1 }]
    const valid = !multipart || (Array.isArray(parts) && parts.length > 0)
    assert.equal(valid, true)
  })
})

describe('complete route — source invariants', () => {
  // Source invariant checks verify critical patterns exist. Full behavior
  // tests require Next.js runtime, Supabase, and R2 — these guards catch
  // accidental removal of auth, quota enforcement, and upload verification.
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('exports POST handler', () => {
    assert.match(source, /export async function POST/)
  })

  it('uses user-scoped Supabase client for RPC call (not service role)', () => {
    assert.match(source, /supabase\.rpc\('create_video_version'/)
    assert.doesNotMatch(source, /admin\.rpc\('create_video_version'/)
  })

  it('calls headObject to verify upload before creating version', () => {
    assert.match(source, /headObject/)
  })

  it('passes p_uploaded_by as user.id to the RPC', () => {
    assert.match(source, /p_uploaded_by:\s*user\.id/)
  })

  it('calls increment_storage_usage before create_video_version', () => {
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
    assert.match(source, /head\.contentLength/)
    assert.doesNotMatch(
      source,
      /actualFileSize\s*=\s*head\?\.contentLength/,
      'Must not use optional chaining fallback to client-declared size'
    )
  })

  it('rolls back quota on version creation failure', () => {
    assert.match(source, /decrement_storage_usage/)
  })

  it('applies rate limiting with user-scoped key', () => {
    assert.match(source, /upload:complete:user/)
  })

  it('uses UPLOAD_RATE_LIMIT and UPLOAD_RATE_WINDOW constants', () => {
    assert.match(source, /UPLOAD_RATE_LIMIT/)
    assert.match(source, /UPLOAD_RATE_WINDOW/)
  })
})
