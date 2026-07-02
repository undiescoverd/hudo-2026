/**
 * Unit tests for useVideoComments — source invariants (via file inspection).
 *
 * The hook itself requires a browser environment (Realtime + fetch), which is
 * not available in the Node test runner, so these tests assert the shape of
 * the source instead: exactly one fetch of the comments endpoint, and that
 * the hook is the single owner of comment state shared by CommentPanel and
 * VideoPlayer (see app/(dashboard)/videos/[id]/page.tsx).
 *
 * Run: npx tsx --test "hooks/useVideoComments.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('useVideoComments — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'useVideoComments.ts'), 'utf8')
  })

  it('is a client hook', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a useVideoComments hook', () => {
    assert.match(source, /export function useVideoComments/)
  })

  it('fetches the comments endpoint exactly once', () => {
    const matches = [
      ...source.matchAll(
        /fetch\(\s*`\/api\/videos\/\$\{encodeURIComponent\(videoId\)\}\/versions\/\$\{encodeURIComponent\(versionId\)\}\/comments`/g
      ),
    ]
    assert.equal(matches.length, 1, 'must fetch the comments endpoint exactly once')
  })

  it('skips the fetch entirely when there is no active version', () => {
    assert.match(source, /if \(!versionId\) \{/)
  })

  it('subscribes to realtime comment changes scoped to the video version', () => {
    assert.match(source, /useRealtimeComments\(/)
    assert.match(source, /videoVersionId: versionId/)
  })

  it('dedupes inserts by id (optimistic insert vs realtime echo)', () => {
    assert.match(source, /prev\.some\(\(c\) => c\.id === comment\.id\)/)
  })

  it('exposes comments, loading, error, and mutation handlers for callers to share', () => {
    assert.match(
      source,
      /return \{ comments, loading, error, handleInsert, handleOptimisticRollback \}/
    )
  })
})
