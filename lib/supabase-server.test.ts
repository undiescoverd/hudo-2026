/**
 * Unit tests for the Supabase server client helper.
 * Run: npx tsx --test lib/supabase-server.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

describe('supabase-server — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'supabase-server.ts')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('exports createSupabaseServerClient function', () => {
    assert.match(source, /export async function createSupabaseServerClient/)
  })

  it('uses for...of in setAll (not forEach)', () => {
    assert.match(source, /for \(const .* of cookiesToSet\)/)
    assert.doesNotMatch(source, /cookiesToSet\.forEach/)
  })

  it('awaits cookies()', () => {
    assert.match(source, /await cookies\(\)/)
  })
})
