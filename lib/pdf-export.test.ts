/**
 * lib/pdf-export.test.ts
 *
 * Tests for pdf-export.ts. No Supabase, no Next.js, no network calls.
 * Run with: npx tsx --test lib/pdf-export.test.ts
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { canExport, buildCommentExportPdf } from './pdf-export.js'

// ---------------------------------------------------------------------------
// canExport — pure authz logic
// ---------------------------------------------------------------------------

describe('canExport', () => {
  const AGENT_ID = 'agent-user-id'
  const TALENT_ID = 'talent-user-id'
  const OTHER_TALENT = 'other-talent-id'

  test('talent can export their own video', () => {
    assert.equal(canExport({ role: 'talent', videoTalentId: TALENT_ID, userId: TALENT_ID }), true)
  })

  test('talent cannot export another talent video — 403', () => {
    assert.equal(
      canExport({ role: 'talent', videoTalentId: OTHER_TALENT, userId: TALENT_ID }),
      false
    )
  })

  test('agent can export any video in their agency', () => {
    assert.equal(canExport({ role: 'agent', videoTalentId: OTHER_TALENT, userId: AGENT_ID }), true)
  })

  test('admin_agent can export any video', () => {
    assert.equal(
      canExport({ role: 'admin_agent', videoTalentId: OTHER_TALENT, userId: AGENT_ID }),
      true
    )
  })

  test('owner can export any video', () => {
    assert.equal(canExport({ role: 'owner', videoTalentId: OTHER_TALENT, userId: AGENT_ID }), true)
  })

  // "agent-other-agency" case: requireMembership already rejects that at the route level
  // before canExport is called. The pure function just checks role and ownership.
  // So an agent (role='agent') with the right agency always returns true.
  test('guest role is rejected (unknown role)', () => {
    assert.equal(canExport({ role: 'guest', videoTalentId: TALENT_ID, userId: TALENT_ID }), false)
  })
})

// ---------------------------------------------------------------------------
// buildCommentExportPdf — PDF bytes output
// ---------------------------------------------------------------------------

describe('buildCommentExportPdf', () => {
  const BASE_INPUT = {
    videoTitle: 'My Test Video',
    versionNumber: 2,
    exportDate: new Date('2026-06-16T10:00:00Z'),
    generatorName: 'Jane Doe',
    comments: [],
  }

  test('returns Uint8Array starting with PDF magic bytes %PDF', async () => {
    const bytes = await buildCommentExportPdf(BASE_INPUT)
    assert.ok(bytes instanceof Uint8Array, 'result is Uint8Array')
    // PDF magic: 0x25 0x50 0x44 0x46 → "%PDF"
    assert.equal(bytes[0], 0x25, 'byte 0 is %')
    assert.equal(bytes[1], 0x50, 'byte 1 is P')
    assert.equal(bytes[2], 0x44, 'byte 2 is D')
    assert.equal(bytes[3], 0x46, 'byte 3 is F')
  })

  test('produces a non-empty PDF with no comments', async () => {
    const bytes = await buildCommentExportPdf(BASE_INPUT)
    assert.ok(bytes.length > 100, 'PDF is non-trivially sized')
  })

  test('produces a PDF with multiple comments', async () => {
    const input = {
      ...BASE_INPUT,
      comments: [
        {
          id: '1',
          timestamp_seconds: 65,
          commenter_name: 'Alice',
          content: 'Great shot!',
          resolved: false,
        },
        {
          id: '2',
          timestamp_seconds: 130,
          commenter_name: 'Bob',
          content: 'Needs colour grade.',
          resolved: true,
        },
      ],
    }
    const bytes = await buildCommentExportPdf(input)
    assert.ok(bytes instanceof Uint8Array)
    assert.ok(bytes.length > 200, 'PDF with comments is larger than empty PDF')
  })

  test('handles special chars in content without throwing', async () => {
    const input = {
      ...BASE_INPUT,
      comments: [
        {
          id: '1',
          timestamp_seconds: 0,
          commenter_name: 'Alice ’s note',
          content: 'Smart “quotes” and emoji 😀 here',
          resolved: false,
        },
      ],
    }
    // Should not throw (sanitiseText replaces non-WinAnsi chars with '?')
    const bytes = await buildCommentExportPdf(input)
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes[0], 0x25)
  })

  test('handles null timestamp_seconds gracefully', async () => {
    const input = {
      ...BASE_INPUT,
      comments: [
        {
          id: '1',
          timestamp_seconds: null,
          commenter_name: 'Alice',
          content: 'No timestamp.',
          resolved: false,
        },
      ],
    }
    const bytes = await buildCommentExportPdf(input)
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes[0], 0x25)
  })

  test('handles very long comment body (wrapping/pagination)', async () => {
    const longContent = 'This is a very long comment. '.repeat(100)
    const input = {
      ...BASE_INPUT,
      comments: Array.from({ length: 30 }, (_, i) => ({
        id: String(i),
        timestamp_seconds: i * 10,
        commenter_name: `User ${i}`,
        content: longContent,
        resolved: i % 2 === 0,
      })),
    }
    const bytes = await buildCommentExportPdf(input)
    assert.ok(bytes instanceof Uint8Array)
    assert.equal(bytes[0], 0x25)
    // Multi-page PDF should be substantially larger
    assert.ok(bytes.length > 5000, 'large PDF exceeds 5KB')
  })
})

// ---------------------------------------------------------------------------
// UUID validation (inline — tests the guard logic used in the route)
// Note: We test the pure isValidUUID function to cover the 400 path without
// importing Next.js route machinery.
// ---------------------------------------------------------------------------

describe('isValidUUID', () => {
  // Dynamic import to avoid test-runner issues with module resolution
  test('valid UUID returns true', async () => {
    const { isValidUUID } = await import('./validation.js')
    assert.equal(isValidUUID('550e8400-e29b-41d4-a716-446655440000'), true)
  })

  test('invalid UUID returns false (triggers 400 in route)', async () => {
    const { isValidUUID } = await import('./validation.js')
    assert.equal(isValidUUID('not-a-uuid'), false)
    assert.equal(isValidUUID(''), false)
    assert.equal(isValidUUID('123'), false)
  })
})
