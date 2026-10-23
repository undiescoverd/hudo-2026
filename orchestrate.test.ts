/**
 * Tests for the sync-check drift detection in orchestrate.js.
 *
 * Covers the commit-subject rule for git drift (a task ID in a commit body, or in a
 * `chore` subject, must not mark the task merged), the behaviour of detectGitDrift
 * against a throwaway git repo, and the markdown-vs-Linear drift rule (including
 * `not_started` tasks that Linear wrongly shows as started). No network, no Linear.
 *
 * Run: pnpm exec tsx --test orchestrate.test.ts
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { detectGitDrift, linearDrifted, subjectShowsTaskMerged } from './orchestrate.js'

describe('subjectShowsTaskMerged', () => {
  it('is false when the ID is not in the subject (body-only mention)', () => {
    assert.equal(
      subjectShowsTaskMerged('chore(plan): archive, delete, erase', 'S9-PLAN-001'),
      false
    )
    assert.equal(subjectShowsTaskMerged('feat(upload): build presigner', 'S9-PLAN-001'), false)
  })

  it('is true for a feat commit that names the ID', () => {
    assert.equal(subjectShowsTaskMerged('feat(x): thing (S9-REAL-001) (#1)', 'S9-REAL-001'), true)
  })

  it('is false for a chore commit that names the ID', () => {
    assert.equal(subjectShowsTaskMerged('chore(tasks): add S9-ROW-001 row', 'S9-ROW-001'), false)
    assert.equal(
      subjectShowsTaskMerged('chore(s3): add audit task rows (S9-SEC-005/006)', 'S9-SEC-005'),
      false
    )
  })

  it('is true for a merge-commit subject carrying the branch name', () => {
    assert.equal(
      subjectShowsTaskMerged(
        'Merge pull request #1 from o/feat/s9-S9-REAL-001-slug',
        'S9-REAL-001'
      ),
      true
    )
  })
})

describe('detectGitDrift', () => {
  let repo: string
  let originalCwd: string

  function commit(...messages: string[]) {
    const args = [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      '-c',
      'commit.gpgsign=false',
    ]
    args.push('commit', '--allow-empty')
    for (const m of messages) args.push('-m', m)
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  }

  before(() => {
    originalCwd = process.cwd()
    repo = mkdtempSync(path.join(tmpdir(), 'orchestrate-drift-'))
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' })
    commit('chore(plan): archive, delete, erase', 'Plans S9-PLAN-001 for later.')
    commit('chore(tasks): add S9-ROW-001 row')
    commit('feat(x): build it (S9-REAL-001)')
    process.chdir(repo)
  })

  after(() => {
    process.chdir(originalCwd)
    rmSync(repo, { recursive: true, force: true })
  })

  it('flags only the task whose ID is in a non-chore commit subject', () => {
    const drift = detectGitDrift([
      { id: 'S9-PLAN-001', status: 'not_started' },
      { id: 'S9-ROW-001', status: 'not_started' },
      { id: 'S9-REAL-001', status: 'in_review' },
    ])
    assert.deepEqual(
      drift.map((d) => d.id),
      ['S9-REAL-001']
    )
    assert.equal(drift[0].mergedIn, 'main')
    assert.match(
      drift[0].evidence ?? '',
      /^task id in main history: [0-9a-f]+ feat\(x\): build it \(S9-REAL-001\)$/
    )
  })
})

describe('linearDrifted', () => {
  it('flags a not_started task that Linear shows as Done', () => {
    assert.equal(linearDrifted('not_started', 'Done'), true)
  })

  it('accepts unstarted and in-flight Linear states for a not_started task', () => {
    assert.equal(linearDrifted('not_started', 'Backlog'), false)
    assert.equal(linearDrifted('not_started', 'Todo'), false)
    assert.equal(linearDrifted('not_started', 'Triage'), false)
    // The status bump lives on the open feature branch; linear-update.yml moves Linear
    assert.equal(linearDrifted('not_started', 'In Progress'), false)
    assert.equal(linearDrifted('not_started', 'In Review'), false)
  })

  it('requires the exact mapped state for other statuses', () => {
    assert.equal(linearDrifted('in_review', 'In Review'), false)
    assert.equal(linearDrifted('in_review', 'Done'), true)
    assert.equal(linearDrifted('done', 'Done'), false)
    assert.equal(linearDrifted('done', 'In Review'), true)
  })

  it('compares case-insensitively', () => {
    assert.equal(linearDrifted('not_started', 'done'), true)
    assert.equal(linearDrifted('done', 'done'), false)
    assert.equal(linearDrifted('in_progress', 'IN PROGRESS'), false)
  })
})
