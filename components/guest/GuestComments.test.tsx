/**
 * GuestComments — source invariants (node:test + fs.readFileSync pattern).
 * Tests check the static source to enforce security and UX contracts without
 * requiring a DOM runtime.
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('GuestComments — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'GuestComments.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a GuestComments component', () => {
    assert.match(source, /export function GuestComments/)
  })

  it('does not import Supabase', () => {
    assert.doesNotMatch(source, /@supabase/)
  })

  it('does not import useSignedUrl or any authenticated hook', () => {
    assert.doesNotMatch(source, /useSignedUrl/)
    assert.doesNotMatch(source, /useSupabase/)
  })

  it('renders display_name as the comment author', () => {
    assert.match(source, /display_name/)
  })

  it('does not render any comment action buttons (resolve, reply, delete)', () => {
    // Strip comments first so doc-comment words like "resolve"/"reply"/"delete"
    // don't trip the invariant check — we only care about the executable code.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /resolve|reply|delete/i)
  })

  it('uses formatTime to display timestamp_seconds', () => {
    assert.match(source, /formatTime/)
    assert.match(source, /timestamp_seconds/)
  })

  it('handles empty comments list gracefully', () => {
    assert.match(source, /length === 0|\.length === 0/)
  })
})
