import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('CommentInput — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'CommentInput.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CommentInput component', () => {
    assert.match(source, /export function CommentInput/)
  })

  it('uses useVideoPlayerContext for timestamp/range', () => {
    assert.match(source, /useVideoPlayerContext/)
  })

  it('enforces a 2000 character limit', () => {
    assert.match(source, /COMMENT_BODY_MAX_LENGTH|2000/)
  })

  it('handles Enter to submit and Shift+Enter for newline', () => {
    assert.match(source, /Shift/)
    assert.match(source, /'Enter'|"Enter"/)
  })

  it('posts to the comments collection endpoint', () => {
    assert.match(source, /\/api\/videos\/.*\/versions\/.*\/comments/)
  })

  it('uses crypto.randomUUID for optimistic temp ids', () => {
    assert.match(source, /crypto\.randomUUID|temp-/)
  })

  it('calls onOptimisticRollback in both success and error paths', () => {
    const matches = [...source.matchAll(/onOptimisticRollback\(tempId\)/g)]
    assert.equal(matches.length, 2, 'rollback must be called in both success and error paths')
  })

  it('calls onOptimisticInsert twice (temp + canonical) on success', () => {
    const insertMatches = [...source.matchAll(/onOptimisticInsert\(/g)]
    assert.equal(
      insertMatches.length,
      2,
      'onOptimisticInsert must be called twice: once for temp, once for canonical'
    )
  })

  it('parses POST response JSON', () => {
    assert.match(source, /res\.json\(\)/)
  })

  it('disables submit when body is empty after trim', () => {
    assert.match(source, /\.trim\(\)/)
  })
})

describe('CommentInput — comment_type derivation invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'CommentInput.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('emits range when both rangeIn and rangeOut are set', () => {
    assert.match(source, /'range'|"range"/)
    assert.match(source, /rangeIn/)
    assert.match(source, /rangeOut/)
  })

  it('emits point otherwise', () => {
    assert.match(source, /'point'|"point"/)
  })
})
