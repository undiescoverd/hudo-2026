/**
 * Talent tracker: stage mapping, grouping and row CTA.
 * Run: pnpm exec tsx --test components/dashboard/talent/tracker.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TalentVideo } from '@/lib/talent-dashboard'
import { getRowAction, getRowReason, getTrackerSteps, groupTalentVideos } from './tracker'

const v = (over: Partial<TalentVideo>): TalentVideo => ({
  id: 'v1',
  title: 'T',
  status: 'in_review',
  thumbnail_r2_key: null,
  created_at: '2026-01-01',
  latest_version: 2,
  unread_count: 0,
  ...over,
})

describe('getTrackerSteps', () => {
  it('maps each status to the right current step', () => {
    const now = (s: TalentVideo['status']) => getTrackerSteps(s).findIndex((x) => x.state === 'now')
    assert.equal(now('draft'), 0)
    assert.equal(now('pending_review'), 1)
    assert.equal(now('in_review'), 2)
    assert.equal(now('changes_requested'), 2)
    assert.equal(now('approved'), 3)
  })

  it('marks earlier steps done and later steps todo', () => {
    assert.deepEqual(
      getTrackerSteps('in_review').map((s) => s.state),
      ['done', 'done', 'now', 'todo']
    )
  })

  it('relabels step 3 for changes requested', () => {
    assert.equal(getTrackerSteps('changes_requested')[2].label, 'Changes requested')
    assert.equal(getTrackerSteps('in_review')[2].label, 'In review')
  })
})

describe('groupTalentVideos', () => {
  it('puts changes_requested, draft and unread videos in Your move, urgent first', () => {
    const list = [
      v({ id: 'a', status: 'approved' }),
      v({ id: 'b', status: 'in_review', unread_count: 2 }),
      v({ id: 'c', status: 'draft' }),
      v({ id: 'd', status: 'changes_requested' }),
      v({ id: 'e', status: 'pending_review' }),
    ]
    const { yourMove, rest } = groupTalentVideos(list)
    assert.deepEqual(
      yourMove.map((x) => x.id),
      ['d', 'c', 'b']
    )
    assert.deepEqual(
      rest.map((x) => x.id),
      ['a', 'e']
    )
  })

  it('returns an empty Your move when nothing needs the talent', () => {
    const { yourMove, rest } = groupTalentVideos([v({ status: 'approved' })])
    assert.equal(yourMove.length, 0)
    assert.equal(rest.length, 1)
  })
})

describe('getRowAction', () => {
  it('links changes_requested to Upload v{n+1} on /upload?videoId=<id>', () => {
    const a = getRowAction(v({ id: 'abc', status: 'changes_requested', latest_version: 3 }))
    assert.deepEqual(a, { kind: 'link', label: 'Upload v4', href: '/upload?videoId=abc' })
  })

  it('has no upload CTA for non-changes statuses', () => {
    for (const status of ['pending_review', 'in_review', 'approved'] as const) {
      assert.equal(getRowAction(v({ status })).kind, 'none')
    }
  })

  it('offers Read comments when unread', () => {
    const a = getRowAction(v({ status: 'in_review', unread_count: 1 }))
    assert.equal(a.kind === 'link' && a.label, 'Read comments')
  })
})

describe('getRowReason', () => {
  it('counts comments to address for changes_requested', () => {
    assert.equal(
      getRowReason(v({ status: 'changes_requested', unread_count: 1 })).emphasis,
      '1 comment to address'
    )
  })
})

describe('TalentDashboard source', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const dash = fs.readFileSync(path.resolve(dir, '../TalentDashboard.tsx'), 'utf8')
  it('renders Your move and Everything else groups', () => {
    assert.match(dash, /Your move/)
    assert.match(dash, /Everything else/)
  })
  it('uses no raw hex colours', () => {
    assert.doesNotMatch(dash, /#[0-9a-fA-F]{3,6}\b/)
  })
})
