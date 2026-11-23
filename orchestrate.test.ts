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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  TASK_ID_BRANCH_PATTERN,
  buildCreateInput,
  buildTaskIssueMap,
  classifyTasks,
  cmdSyncCheck,
  cmdSyncFix,
  createLinearClient,
  detectGitDrift,
  extractTaskIdFromBranch,
  fetchLinearIssues,
  inferSprintProject,
  linearDrifted,
  subjectShowsTaskMerged,
  syncExitCode,
} from './orchestrate.js'

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

// ─── Linear batch sync ──────────────────────────────────────────────────────────

describe('extractTaskIdFromBranch', () => {
  it('extracts and uppercases the canonical ID anywhere in the branch', () => {
    assert.equal(extractTaskIdFromBranch('feat/s5-S5-FLOW-003-reopen-on-approved'), 'S5-FLOW-003')
    assert.equal(extractTaskIdFromBranch('fix/s5-S5-FLOW-005-realtime-author'), 'S5-FLOW-005')
    assert.equal(extractTaskIdFromBranch('feat/s4-S4-UPLOADFIX-001-x'), 'S4-UPLOADFIX-001')
  })

  it('still handles the older lowercase form', () => {
    assert.equal(extractTaskIdFromBranch('feat/s2-dash-003-status-workflow'), 'S2-DASH-003')
  })

  it('returns null for branches without a task ID', () => {
    assert.equal(extractTaskIdFromBranch('chore/s4-status-sync'), null)
    assert.equal(extractTaskIdFromBranch('chore/pin-playwright-runner'), null)
  })

  it('uses the exact same pattern in every extraction in linear-update.yml', () => {
    const yml = readFileSync(path.join(__dirname, '.github/workflows/linear-update.yml'), 'utf8')
    const lines = yml.split('\n').filter((l) => l.includes('re.search('))
    assert.equal(lines.length, 3)
    for (const l of lines) {
      assert.ok(l.includes(`r'${TASK_ID_BRANCH_PATTERN}', branch, re.I)`), l)
    }
  })
})

const issue = (
  identifier: string,
  title: string,
  stateName = 'Backlog',
  stateType = 'backlog',
  project: { id: string; name: string } | null = null
) => ({
  id: `id-${identifier}`,
  identifier,
  title,
  state: { id: `s-${stateName}`, name: stateName, type: stateType },
  project,
})

describe('buildTaskIssueMap', () => {
  it('maps tasks by title prefix, case-insensitively', () => {
    const { map, ambiguous } = buildTaskIssueMap(
      [issue('RES-1', 'S4-FOO-001 — Foo'), issue('RES-2', 's4-bar-002 — Bar')],
      ['S4-FOO-001', 'S4-BAR-002', 'S4-NONE-003']
    )
    assert.equal(map.get('S4-FOO-001')?.identifier, 'RES-1')
    assert.equal(map.get('S4-BAR-002')?.identifier, 'RES-2')
    assert.equal(map.has('S4-NONE-003'), false)
    assert.deepEqual(ambiguous, [])
  })

  it('skips dup-renamed titles and canceled / Duplicate states', () => {
    const { map } = buildTaskIssueMap(
      [
        issue('RES-1', '[dup of RES-9] S4-FOO-001 — Foo'),
        issue('RES-2', 'S4-FOO-001 — Foo', 'Canceled', 'canceled'),
        issue('RES-3', 'S4-FOO-001 — Foo', 'Duplicate', 'canceled'),
      ],
      ['S4-FOO-001']
    )
    assert.equal(map.has('S4-FOO-001'), false)
  })

  it('prefers the live issue over a canceled one', () => {
    const { map, ambiguous } = buildTaskIssueMap(
      [
        issue('RES-1', 'S4-FOO-001 — Foo', 'Canceled', 'canceled'),
        issue('RES-5', 'S4-FOO-001 — Foo'),
      ],
      ['S4-FOO-001']
    )
    assert.equal(map.get('S4-FOO-001')?.identifier, 'RES-5')
    assert.deepEqual(ambiguous, [])
  })

  it('reports ambiguity between live issues and picks the lowest identifier', () => {
    const { map, ambiguous } = buildTaskIssueMap(
      [issue('RES-9', 'S4-FOO-001 — Foo'), issue('RES-4', 'S4-FOO-001 again')],
      ['S4-FOO-001']
    )
    assert.equal(map.get('S4-FOO-001')?.identifier, 'RES-4')
    assert.deepEqual(ambiguous, [{ id: 'S4-FOO-001', chosen: 'RES-4', others: ['RES-9'] }])
  })

  it('does not let S4-FOO-001 claim S4-FOO-0011', () => {
    const { map } = buildTaskIssueMap([issue('RES-1', 'S4-FOO-0011 — other')], ['S4-FOO-001'])
    assert.equal(map.has('S4-FOO-001'), false)
  })
})

describe('classifyTasks', () => {
  const tasks = [
    { id: 'S9-A-001', status: 'done' },
    { id: 'S9-A-002', status: 'in_review' },
    { id: 'S9-A-003', status: 'not_started' },
    { id: 'S9-A-004', status: 'not_started' },
    { id: 'S9-A-005', status: 'weird' },
  ]

  it('classifies ok, drifted and missing', () => {
    const { map } = buildTaskIssueMap(
      [
        issue('RES-1', 'S9-A-001 x', 'Done', 'completed'),
        issue('RES-2', 'S9-A-002 x', 'Done', 'completed'),
        issue('RES-3', 'S9-A-003 x', 'In Progress', 'started'),
      ],
      tasks.map((t) => t.id)
    )
    const r = classifyTasks(tasks, map)
    assert.deepEqual(
      r.map((x: { id: string; status: string }) => [x.id, x.status]),
      [
        ['S9-A-001', 'ok'],
        ['S9-A-002', 'drifted'],
        ['S9-A-003', 'ok'], // not_started vs In Progress is not drift
        ['S9-A-004', 'missing'],
      ]
    )
  })

  it('flags a not_started task that Linear shows Done', () => {
    const { map } = buildTaskIssueMap(
      [issue('RES-3', 'S9-A-003 x', 'Done', 'completed')],
      ['S9-A-003']
    )
    assert.equal(classifyTasks([tasks[2]], map)[0].status, 'drifted')
  })

  it('classifies everything as error when the Linear fetch failed', () => {
    const r = classifyTasks(tasks, null)
    assert.equal(r.length, 4)
    assert.ok(r.every((x: { status: string }) => x.status === 'error'))
  })
})

describe('inferSprintProject', () => {
  const p1 = { id: 'p1', name: 'Sprint 4' }
  const p2 = { id: 'p2', name: 'Other' }

  it('picks the project most used by the same sprint prefix', () => {
    const issues = [
      issue('R-1', 'S4-A-001 x', 'Done', 'completed', p1),
      issue('R-2', 'S4-A-002 x', 'Done', 'completed', p1),
      issue('R-3', 'S4-A-003 x', 'Done', 'completed', p2),
      issue('R-4', 'S5-A-001 x', 'Done', 'completed', p2),
      issue('R-5', 'S5-A-002 x', 'Done', 'completed', p2),
    ]
    assert.deepEqual(inferSprintProject('S4-NEW-001', issues), p1)
    assert.deepEqual(inferSprintProject('S5-NEW-001', issues), p2)
  })

  it('returns null when no sibling has a project', () => {
    assert.equal(inferSprintProject('S6-NEW-001', [issue('R-1', 'S6-A-001 x')]), null)
    assert.equal(
      inferSprintProject('S7-NEW-001', [issue('R-1', 'S4-A-001 x', 'Done', 'completed', p1)]),
      null
    )
  })

  it('builds the create input from the markdown block', () => {
    const input = buildCreateInput(
      {
        id: 'S4-NEW-001',
        title: 'Do the thing',
        status: 'not_started',
        filePath: '/x/tasks/sprint-4.md',
      },
      [issue('R-1', 'S4-A-001 x', 'Done', 'completed', p1)]
    )
    assert.equal(input.title, 'S4-NEW-001 — Do the thing')
    assert.equal(input.stateName, 'Backlog')
    assert.deepEqual(input.project, p1)
    assert.match(input.description, /tasks\/sprint-4\.md/)
    assert.match(input.description, /sync-fix/)
  })
})

describe('Linear client retry', () => {
  const ok = () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })

  it('retries a 429, honouring Retry-After, then succeeds', async () => {
    const delays: number[] = []
    let calls = 0
    const client = createLinearClient({
      apiKey: 'test-key',
      fetchFn: async () => {
        calls++
        return calls < 3 ? new Response('', { status: 429, headers: { 'Retry-After': '7' } }) : ok()
      },
      sleepFn: async (ms: number) => void delays.push(ms),
    })
    assert.deepEqual(await client.request('query { x }'), { ok: true })
    assert.equal(calls, 3)
    assert.deepEqual(delays, [7000, 7000])
  })

  it('uses exponential backoff without Retry-After and retries 5xx', async () => {
    const delays: number[] = []
    let calls = 0
    const client = createLinearClient({
      apiKey: 'test-key',
      fetchFn: async () => (++calls < 4 ? new Response('', { status: 503 }) : ok()),
      sleepFn: async (ms: number) => void delays.push(ms),
    })
    await client.request('query { x }')
    assert.deepEqual(delays, [1000, 2000, 4000])
  })

  it('gives up after 4 attempts', async () => {
    let calls = 0
    const client = createLinearClient({
      apiKey: 'test-key',
      fetchFn: async () => {
        calls++
        return new Response('', { status: 429 })
      },
      sleepFn: async () => {},
    })
    await assert.rejects(client.request('query { x }'), /HTTP 429.*4 attempts/)
    assert.equal(calls, 4)
  })

  it('does not retry GraphQL errors and never leaks the key', async () => {
    let calls = 0
    const client = createLinearClient({
      apiKey: 'secret-key-123',
      fetchFn: async () => {
        calls++
        return new Response(JSON.stringify({ errors: [{ message: 'bad query' }] }), {
          status: 400,
        })
      },
      sleepFn: async () => {},
    })
    await assert.rejects(client.request('query { x }'), (e: Error) => {
      assert.match(e.message, /bad query/)
      assert.ok(!e.message.includes('secret-key-123'))
      return true
    })
    assert.equal(calls, 1)
  })
})

describe('fetchLinearIssues pagination', () => {
  it('follows pageInfo cursors', async () => {
    const afters: unknown[] = []
    const client = {
      request: async (q: string, vars: { after: string | null }) => {
        assert.match(q, /includeArchived: true/) // archived Done issues must not look MISSING
        afters.push(vars.after)
        return vars.after
          ? { issues: { nodes: [issue('R-2', 'S1-A-002')], pageInfo: { hasNextPage: false } } }
          : {
              issues: {
                nodes: [issue('R-1', 'S1-A-001')],
                pageInfo: { hasNextPage: true, endCursor: 'c1' },
              },
            }
      },
    }
    const all = await fetchLinearIssues(client)
    assert.deepEqual(
      all.map((i: { identifier: string }) => i.identifier),
      ['R-1', 'R-2']
    )
    assert.deepEqual(afters, [null, 'c1'])
  })
})

describe('--ci exit codes and sync-fix', () => {
  const tasks = [
    { id: 'S9-A-001', title: 'One', status: 'done', filePath: '/x/tasks/sprint-9.md' },
    { id: 'S9-A-002', title: 'Two', status: 'in_review', filePath: '/x/tasks/sprint-9.md' },
    { id: 'S9-A-003', title: 'Three', status: 'not_started', filePath: '/x/tasks/sprint-9.md' },
  ]
  const states = [
    { id: 'st-backlog', name: 'Backlog', type: 'backlog' },
    { id: 'st-review', name: 'In Review', type: 'started' },
    { id: 'st-done', name: 'Done', type: 'completed' },
  ]
  const proj = { id: 'p9', name: 'Sprint 9' }

  /** A fake Linear: issues held in memory, mutations applied to them. */
  function fakeLinear(initial: ReturnType<typeof issue>[], opts: { failIssues?: boolean } = {}) {
    const issues = [...initial]
    const calls: string[] = []
    const client = {
      request: async (
        query: string,
        vars: { id: string; stateId: string; input: Record<string, string> }
      ) => {
        if (opts.failIssues && query.includes('issues(')) throw new Error('HTTP 429 (gave up)')
        if (query.includes('issues(')) {
          return { issues: { nodes: issues, pageInfo: { hasNextPage: false } } }
        }
        if (query.includes('teams(')) {
          return { teams: { nodes: [{ id: 'team1', states: { nodes: states } }] } }
        }
        if (query.includes('issueUpdate')) {
          const i = issues.find((x) => x.id === vars.id)!
          i.state = states.find((s) => s.id === vars.stateId)!
          calls.push(`update ${i.identifier} -> ${i.state.name}`)
          return { issueUpdate: { success: true } }
        }
        if (query.includes('issueCreate')) {
          const n = `RES-${100 + issues.length}`
          const created = issue(
            n,
            vars.input.title,
            states.find((s) => s.id === vars.input.stateId)!.name,
            'x',
            vars.input.projectId ? proj : null
          )
          issues.push(created)
          calls.push(`create ${vars.input.title} project=${vars.input.projectId ?? 'none'}`)
          return { issueCreate: { success: true, issue: { id: created.id, identifier: n } } }
        }
        throw new Error('unexpected query')
      },
    }
    return { client, calls, issues }
  }

  const quiet = async <T>(fn: () => Promise<T>) => {
    const log = console.log
    console.log = () => {}
    try {
      return await fn()
    } finally {
      console.log = log
    }
  }

  it('syncExitCode is 1 for any drifted, missing, error or git-drift count', () => {
    const zero = { driftCount: 0, missingCount: 0, errorCount: 0, gitDriftCount: 0 }
    assert.equal(syncExitCode(zero), 0)
    assert.equal(syncExitCode({ ...zero, driftCount: 1 }), 1)
    assert.equal(syncExitCode({ ...zero, missingCount: 1 }), 1)
    assert.equal(syncExitCode({ ...zero, errorCount: 1 }), 1)
    assert.equal(syncExitCode({ ...zero, gitDriftCount: 1 }), 1)
    assert.equal(syncExitCode({ ...zero, failed: 1 }), 1)
  })

  it('sync-check --ci fails on drift and missing, passes when in sync', async () => {
    const synced = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Done'),
      issue('R-2', 'S9-A-002 — Two', 'In Review'),
      issue('R-3', 'S9-A-003 — Three', 'Backlog'),
    ])
    const good = await quiet(() =>
      cmdSyncCheck({ tasks, client: synced.client, gitDrift: () => [] })
    )
    assert.equal(good.exitCode, 0)

    const bad = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Backlog'),
      issue('R-2', 'S9-A-002 — Two', 'In Review'),
    ])
    const res = await quiet(() => cmdSyncCheck({ tasks, client: bad.client, gitDrift: () => [] }))
    assert.equal(res.driftCount, 1)
    assert.equal(res.missingCount, 1)
    assert.equal(res.exitCode, 1)
  })

  it('sync-check --ci fails (ERROR) when Linear is unreachable', async () => {
    const down = fakeLinear([], { failIssues: true })
    const res = await quiet(() => cmdSyncCheck({ tasks, client: down.client, gitDrift: () => [] }))
    assert.equal(res.errorCount, 3)
    assert.equal(res.exitCode, 1)
  })

  it('sync-fix pushes drift, creates missing issues in the inferred project, and re-checks clean', async () => {
    const linear = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Backlog', 'backlog', proj),
      issue('R-2', 'S9-A-002 — Two', 'In Review', 'started', proj),
    ])
    const res = await quiet(() => cmdSyncFix({ tasks, client: linear.client, gitDrift: () => [] }))
    assert.deepEqual(linear.calls, ['update R-1 -> Done', 'create S9-A-003 — Three project=p9'])
    assert.equal(res.exitCode, 0)
    assert.equal(res.missingCount, 0)
    assert.equal(res.driftCount, 0)
  })

  it('sync-fix --ci exits 1 when Linear is unreachable', async () => {
    const down = fakeLinear([], { failIssues: true })
    const before = process.exitCode
    const res = await quiet(() =>
      cmdSyncFix({ ci: true, tasks, client: down.client, gitDrift: () => [] })
    )
    assert.equal(res.exitCode, 1)
    assert.equal(process.exitCode, 1)
    process.exitCode = before
  })
  it('sync-fix leaves a Canceled-only task alone: no create, no update, exit 0', async () => {
    const linear = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Done'),
      issue('R-2', 'S9-A-002 — Two', 'In Review'),
      issue('R-3', 'S9-A-003 — Three', 'Canceled', 'canceled'),
    ])
    const logs: string[] = []
    const log = console.log
    console.log = (m: string) => void logs.push(String(m))
    let res
    try {
      res = await cmdSyncFix({ ci: true, tasks, client: linear.client, gitDrift: () => [] })
    } finally {
      console.log = log
    }
    assert.deepEqual(linear.calls, [])
    assert.equal(res.canceledCount, 1)
    assert.equal(res.missingCount, 0)
    assert.equal(res.exitCode, 0)
    assert.ok(
      logs.some((l) =>
        l.includes(
          'S9-A-003 is Canceled in Linear (R-3); markdown says not_started; not touching it'
        )
      )
    )
    process.exitCode = 0
  })

  it('never pushes a merged (git-drift) task back from Done to its markdown state', async () => {
    const linear = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Done'),
      issue('R-2', 'S9-A-002 — Two', 'Done'),
      issue('R-3', 'S9-A-003 — Three', 'Backlog'),
    ])
    const mergedTwo = [
      { id: 'S9-A-002', branch: '', markdownStatus: 'in_review', mergedIn: 'main', evidence: 'e' },
    ]
    // markdown flip succeeds: Linear already Done, nothing to update
    const ok = await quiet(() =>
      cmdSyncFix({ tasks, client: linear.client, gitDrift: () => mergedTwo, flipDone: () => true })
    )
    assert.deepEqual(linear.calls, [])
    assert.equal(ok.gitDriftCount, 0)
    // markdown flip fails: still never touched in Linear
    const bad = await quiet(() =>
      cmdSyncFix({ tasks, client: linear.client, gitDrift: () => mergedTwo, flipDone: () => false })
    )
    assert.deepEqual(linear.calls, [])
    assert.equal(bad.exitCode, 1)
  })

  it('refuses to create more than 10 issues without --create-all', async () => {
    const many = Array.from({ length: 11 }, (_, n) => ({
      id: `S9-B-${String(n + 1).padStart(3, '0')}`,
      title: `T${n}`,
      status: 'not_started',
      filePath: '/x/tasks/sprint-9.md',
    }))
    const capped = fakeLinear([])
    const refused = await quiet(() =>
      cmdSyncFix({ tasks: many, client: capped.client, gitDrift: () => [] })
    )
    assert.deepEqual(capped.calls, [])
    assert.equal(refused.missingCount, 11)
    assert.equal(refused.exitCode, 1)

    const allowed = fakeLinear([])
    const done = await quiet(() =>
      cmdSyncFix({ tasks: many, client: allowed.client, gitDrift: () => [], createAll: true })
    )
    assert.equal(allowed.calls.length, 11)
    assert.equal(done.exitCode, 0)
  })

  it('titles a create with just the ID when the markdown title is empty', () => {
    const t = { id: 'S9-C-001', title: 'S9-C-001', status: 'not_started' }
    assert.equal(buildCreateInput(t, []).title, 'S9-C-001')
    assert.equal(buildCreateInput({ ...t, title: '' }, []).title, 'S9-C-001')
  })

  it('counts ambiguous matches without failing --ci', async () => {
    const linear = fakeLinear([
      issue('R-1', 'S9-A-001 — One', 'Done'),
      issue('R-9', 'S9-A-001 — One again', 'Done'),
      issue('R-2', 'S9-A-002 — Two', 'In Review'),
      issue('R-3', 'S9-A-003 — Three', 'Backlog'),
    ])
    const res = await quiet(() =>
      cmdSyncCheck({ tasks, client: linear.client, gitDrift: () => [] })
    )
    assert.equal(res.ambiguousCount, 1)
    assert.equal(res.exitCode, 0)
  })
})

describe('non-idempotent Linear requests (issueCreate)', () => {
  const ok = () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
  const opts = { apiKey: 'test-key', sleepFn: async () => {} }

  it('is not retried on a 502', async () => {
    let calls = 0
    const client = createLinearClient({
      ...opts,
      fetchFn: async () => (calls++, new Response('', { status: 502 })),
    })
    await assert.rejects(client.request('m', {}, { idempotent: false }), /outcome unknown/)
    assert.equal(calls, 1)
  })

  it('is not retried on a network error or timeout', async () => {
    let calls = 0
    const client = createLinearClient({
      ...opts,
      fetchFn: async () => {
        calls++
        throw new TypeError('fetch failed')
      },
    })
    await assert.rejects(client.request('m', {}, { idempotent: false }), /outcome unknown/)
    assert.equal(calls, 1)
  })

  it('IS retried on a 429', async () => {
    let calls = 0
    const client = createLinearClient({
      ...opts,
      fetchFn: async () => (++calls < 3 ? new Response('', { status: 429 }) : ok()),
    })
    assert.deepEqual(await client.request('m', {}, { idempotent: false }), { ok: true })
    assert.equal(calls, 3)
    assert.equal(client.stats.retries, 2)
  })

  it('idempotent requests still retry network errors, and pass an abort signal', async () => {
    let calls = 0
    let sawSignal = false
    const client = createLinearClient({
      ...opts,
      fetchFn: async (_url: string, init: { signal?: AbortSignal }) => {
        sawSignal = init.signal instanceof AbortSignal
        if (++calls < 2) throw new TypeError('fetch failed')
        return ok()
      },
    })
    await client.request('q')
    assert.equal(calls, 2)
    assert.ok(sawSignal)
  })
})

describe('canceled classification', () => {
  it('records canceled-only matches separately from live ones', () => {
    const { map, canceled } = buildTaskIssueMap(
      [
        issue('R-1', 'S9-X-001 — a', 'Canceled', 'canceled'),
        issue('R-2', 'S9-X-002 — b', 'Duplicate', 'canceled'),
        issue('R-3', 'S9-X-002 — b', 'Done', 'completed'),
      ],
      ['S9-X-001', 'S9-X-002']
    )
    assert.equal(map.has('S9-X-001'), false)
    assert.equal(canceled.get('S9-X-001')?.identifier, 'R-1')
    assert.equal(map.get('S9-X-002')?.identifier, 'R-3')
    assert.equal(canceled.has('S9-X-002'), false)
    const r = classifyTasks([{ id: 'S9-X-001', status: 'done' }], map, canceled)
    assert.equal(r[0].status, 'canceled')
  })
})
