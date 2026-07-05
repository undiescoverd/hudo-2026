/**
 * Unit tests for lib/comments.ts's rowToComment — focused on the
 * authorName/authorAvatarUrl extraction added alongside the `users` embed
 * (app/api/.../comments/route.ts GET+POST now select
 * `users!comments_user_id_fkey(full_name, avatar_url)`).
 *
 * PostgREST returns an embedded to-one relationship as either a plain object
 * or a single-element array depending on the query shape, so rowToComment
 * must normalize both. Realtime rows carry no `users` key at all, which must
 * yield null for both fields rather than throwing.
 *
 * Run: npx tsx --test lib/comments.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'

const baseRow = {
  id: 'cd71b97f-ad41-464e-b30c-cf8e0532c33b',
  video_version_id: 'c8a40130-be14-43e8-b075-4cb849bf2263',
  agency_id: '3e44aa4d-76ec-4acf-8959-eeac95b40a40',
  user_id: 'ad1e2e82-61ab-4065-a3ec-bc435db0a48a',
  content: 'Great energy here',
  comment_type: 'point',
  timestamp_seconds: 4.2,
  end_timestamp_seconds: null,
  parent_id: null,
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  deleted_at: null,
  created_at: '2026-06-16T02:29:01.223860+00:00',
}

describe('rowToComment — author fields', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rowToComment: (row: Record<string, any>) => any

  before(async () => {
    ;({ rowToComment } = await import('./comments'))
  })

  it('extracts authorName/authorAvatarUrl from an object embed', () => {
    const row = {
      ...baseRow,
      users: { full_name: 'Jordan Casey', avatar_url: 'https://example.com/a.png' },
    }
    const c = rowToComment(row)
    assert.equal(c.authorName, 'Jordan Casey')
    assert.equal(c.authorAvatarUrl, 'https://example.com/a.png')
  })

  it('extracts authorName/authorAvatarUrl from an array embed', () => {
    const row = {
      ...baseRow,
      users: [{ full_name: 'Jordan Casey', avatar_url: 'https://example.com/a.png' }],
    }
    const c = rowToComment(row)
    assert.equal(c.authorName, 'Jordan Casey')
    assert.equal(c.authorAvatarUrl, 'https://example.com/a.png')
  })

  it('yields null for both fields when users is absent (realtime row shape)', () => {
    const row = { ...baseRow }
    const c = rowToComment(row)
    assert.equal(c.authorName, null)
    assert.equal(c.authorAvatarUrl, null)
  })

  it('yields null for both fields when users is an empty array', () => {
    const row = { ...baseRow, users: [] }
    const c = rowToComment(row)
    assert.equal(c.authorName, null)
    assert.equal(c.authorAvatarUrl, null)
  })

  it('yields null when the embedded user has no avatar_url', () => {
    const row = { ...baseRow, users: { full_name: 'Jordan Casey', avatar_url: null } }
    const c = rowToComment(row)
    assert.equal(c.authorName, 'Jordan Casey')
    assert.equal(c.authorAvatarUrl, null)
  })
})
