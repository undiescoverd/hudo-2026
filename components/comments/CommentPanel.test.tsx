/**
 * Unit tests for CommentPanel — source invariants (via file inspection).
 *
 * CommentPanel used to self-fetch its comments and subscribe to Realtime
 * directly, which meant the fetched data was invisible to anything else on
 * the page (e.g. VideoPlayer's CommentTimeline markers). It now receives
 * comments/loading/error and mutation handlers as props from the page-level
 * useVideoComments hook, so there is exactly ONE fetch of the comments
 * endpoint shared by both consumers.
 *
 * Run: npx tsx --test "components/comments/CommentPanel.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('CommentPanel — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentPanel.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentPanel component', () => {
    assert.match(source, /export function CommentPanel/)
  })

  it('does not fetch comments itself (comments come in as a prop)', () => {
    assert.doesNotMatch(source, /fetch\(\s*`\/api\/videos\//)
  })

  it('does not subscribe to Realtime itself (owned by the shared hook)', () => {
    assert.doesNotMatch(source, /useRealtimeComments/)
  })

  it('accepts comments, loading, and error as props', () => {
    assert.match(source, /comments: Comment\[\]/)
    assert.match(source, /loading: boolean/)
    assert.match(source, /error: string \| null/)
  })

  it('accepts onOptimisticInsert/onOptimisticRollback as props and forwards them to CommentInput', () => {
    assert.match(source, /onOptimisticInsert: \(comment: Comment\) => void/)
    assert.match(source, /onOptimisticRollback: \(tempId: string\) => void/)
    assert.match(source, /onOptimisticInsert=\{onOptimisticInsert\}/)
    assert.match(source, /onOptimisticRollback=\{onOptimisticRollback\}/)
  })
})
