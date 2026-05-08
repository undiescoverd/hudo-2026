// Unit tests for the video PATCH route.
//
// Uses Node.js built-in test runner — no Next.js runtime needed.
// Tests source-invariant security checks for the active_version_id branch.
//
// Run: npx tsx --test "app/api/videos/**/*.test.ts"

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

  it('destructures active_version_id from the request body', () => {
    // matches `active_version_id }` or `, active_version_id` or `active_version_id =` in destructuring
    assert.match(source, /\bactive_version_id\s*[},=]/)
  })

  it('uses AGENT_PLUS_ROLES to gate active version changes', () => {
    assert.match(source, /AGENT_PLUS_ROLES/)
  })

  it('validates the version belongs to this video', () => {
    assert.match(source, /video_versions/)
    assert.match(source, /video_id/)
  })

  it('updates videos.active_version_id', () => {
    assert.match(source, /\.update\([^)]*active_version_id/)
  })
})
