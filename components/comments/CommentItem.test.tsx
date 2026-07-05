/**
 * Unit tests for CommentItem — source invariants (via file inspection).
 *
 * Run: npx tsx --test "components/comments/CommentItem.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('CommentItem — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'CommentItem.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentItem component', () => {
    assert.match(source, /export function CommentItem/)
  })

  it('imports formatTimecode and formatRelativeTime from the shared util', () => {
    assert.match(source, /formatTimecode/)
    assert.match(source, /formatRelativeTime/)
    assert.match(source, /from '@\/lib\/format-time'/)
  })

  it('renders comment.authorName', () => {
    assert.match(source, /comment\.authorName/)
  })

  it('renders a relative-time label from comment.createdAt', () => {
    assert.match(source, /formatRelativeTime\(comment\.createdAt\)/)
  })

  it('keeps the timestamp badge as a click-to-seek button', () => {
    assert.match(source, /onClick={\(\) => onSeek\(comment\.timestampSeconds\)}/)
    assert.match(source, /Seek to \$\{formatTimecode\(comment\.timestampSeconds\)\}/)
  })

  it('falls back to a UUID-derived avatar when authorName is absent', () => {
    assert.match(source, /userInitials\(comment\.userId\)/)
  })
})
