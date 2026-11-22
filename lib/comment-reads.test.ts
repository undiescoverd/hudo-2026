/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Behavioural tests for markVideoSeen + the unread count in getTalentVideos,
 * against an in-memory fake of the three tables involved.
 *
 * RLS itself (own row only, agency members only) is covered by
 * tests/rls/comment_reads.test.sql; this suite covers the write payload and
 * how the dashboard turns last_seen_at into an unread count.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { markVideoSeen } from './comment-reads'
import { getTalentVideos } from './talent-dashboard'

type Read = { user_id: string; video_id: string; last_seen_at: string; updated_at: string }

function makeDb(opts: { commentTimes: string[]; failUpsert?: boolean }) {
  const reads: Read[] = []
  const upserts: Array<{ row: Read; options: unknown }> = []

  const result = (data: unknown) => {
    const chain: any = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is']) chain[m] = () => chain
    chain.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
    return chain
  }

  const supabase = {
    from: (table: string) => {
      if (table === 'videos')
        return result([
          {
            id: 'v1',
            title: 'Reel',
            status: 'in_review',
            thumbnail_r2_key: null,
            created_at: '2026-01-01T00:00:00Z',
            video_versions: [{ id: 'ver1', version_number: 1 }],
          },
        ])
      if (table === 'video_versions')
        return result([
          { video_id: 'v1', comments: opts.commentTimes.map((t) => ({ id: t, created_at: t })) },
        ])
      if (table === 'comment_reads')
        return {
          ...result(reads),
          upsert: async (row: Read, options: { onConflict: string }) => {
            if (opts.failUpsert) return { error: { message: 'boom' } }
            upserts.push({ row, options })
            const i = reads.findIndex(
              (r) => r.user_id === row.user_id && r.video_id === row.video_id
            )
            if (i >= 0) reads[i] = row
            else reads.push(row)
            return { error: null }
          },
        }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supabase: supabase as any, reads, upserts }
}

const unread = async (supabase: any, userId = 'talent1') => {
  const { data } = await getTalentVideos({ supabase, user_id: userId, agency_ids: ['a1'] })
  return data[0].unread_count
}

describe('markVideoSeen', () => {
  it('upserts the caller own (user_id, video_id) row with last_seen_at on the conflict key', async () => {
    const db = makeDb({ commentTimes: [] })
    const now = new Date('2026-03-01T10:00:00Z')
    const res = await markVideoSeen(db.supabase, 'talent1', 'v1', now)
    assert.deepEqual(res, { error: null })
    assert.equal(db.upserts.length, 1)
    assert.deepEqual(db.upserts[0].row, {
      user_id: 'talent1',
      video_id: 'v1',
      last_seen_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    assert.deepEqual(db.upserts[0].options, { onConflict: 'user_id,video_id' })
  })

  it('records a read for an agent as well as for talent (separate rows)', async () => {
    const db = makeDb({ commentTimes: [] })
    await markVideoSeen(db.supabase, 'talent1', 'v1')
    await markVideoSeen(db.supabase, 'agent1', 'v1')
    assert.deepEqual(db.reads.map((r) => r.user_id).sort(), ['agent1', 'talent1'])
  })

  it('returns the error instead of throwing when the write fails', async () => {
    const db = makeDb({ commentTimes: [], failUpsert: true })
    const orig = console.error
    console.error = () => {}
    try {
      assert.deepEqual(await markVideoSeen(db.supabase, 'talent1', 'v1'), { error: 'boom' })
    } finally {
      console.error = orig
    }
  })
})

describe('unread count after markVideoSeen', () => {
  const t = (s: string) => `2026-03-01T${s}Z`

  it('is all comments before any visit, 0 after opening, and rises for newer comments', async () => {
    const times = [t('09:00:00'), t('09:30:00')]
    const db = makeDb({ commentTimes: times })
    assert.equal(await unread(db.supabase), 2)

    await markVideoSeen(db.supabase, 'talent1', 'v1', new Date(t('10:00:00')))
    assert.equal(await unread(db.supabase), 0)

    times.push(t('10:05:00'), t('10:06:00'))
    assert.equal(await unread(db.supabase), 2)

    await markVideoSeen(db.supabase, 'talent1', 'v1', new Date(t('10:10:00')))
    assert.equal(await unread(db.supabase), 0)
  })
})
