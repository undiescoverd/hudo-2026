/**
 * Unit tests for the video PATCH route.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source-invariant security checks for the active_version_id branch.
 *
 * Run: npx tsx --test "app/api/videos/[videoId]/route.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

// ---------------------------------------------------------------------------
// videos PATCH route — active_version_id branch source invariants
// ---------------------------------------------------------------------------

describe('videos PATCH route — active_version_id branch', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('accepts active_version_id in PATCH body', () => {
    assert.match(source, /active_version_id/)
  })

  it('uses requireAgentRole to gate active version changes', () => {
    assert.match(source, /requireAgentRole/)
  })

  it('validates the version belongs to this video', () => {
    assert.match(source, /video_versions/)
    assert.match(source, /video_id/)
  })

  it('updates videos.active_version_id', () => {
    assert.match(source, /\.update\([^)]*active_version_id/)
  })
})
