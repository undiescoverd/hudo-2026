/**
 * Guard: app code must hide soft-deleted comments itself.
 *
 * Why this exists: since migrations 0029/0030, the `comments_select` RLS policy
 * deliberately has NO `deleted_at IS NULL` filter (Realtime has to deliver
 * soft-delete UPDATEs; GitHub #187). Soft-deleted rows therefore stay readable
 * to anyone who can see the video, and application code is the only thing
 * hiding them. A new `.from('comments')` read that forgets to filter would
 * surface deleted comments, and the mocked route tests would not notice.
 *
 * What it checks: every non-test .ts/.tsx file under app/, lib/ and hooks/ is
 * scanned for `.from('comments')` chains. Write chains (insert / update /
 * upsert) are skipped. Every read chain must either contain
 * `.is('deleted_at', null)` or list `deleted_at` in its `.select(...)` columns
 * (callers that fetch it and check it in code, e.g. app/api/comments/[id]).
 *
 * Limits: this is a static, syntactic check. It does not prove that a caller
 * which selects `deleted_at` actually acts on it, and it does not see queries
 * built from a variable or a helper, or `comments` embeds from other tables
 * (those filter with `.is('comments.deleted_at', null)`, e.g. lib/dashboard.ts).
 *
 * Run: pnpm exec tsx --test lib/comments-read-guard.test.ts
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['app', 'lib', 'hooks']
const WRITE_METHODS = new Set(['insert', 'update', 'upsert'])
const MIN_READ_CHAINS = 5

interface Call {
  name: string
  args: string
}
interface Chain {
  line: number
  calls: Call[]
}

// ── Chain parser ──────────────────────────────────────────────────────

const FROM_COMMENTS = /\.from\(\s*(['"`])comments\1\s*\)/g
const NEXT_CALL = /\.([A-Za-z_$][\w$]*)\s*\(/y
const IS_DELETED_AT_NULL = /^\s*(['"`])deleted_at\1\s*,\s*null\s*,?\s*$/

/** Index just past the string literal that starts at `i`. */
function skipString(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++
    else if (src[j] === src[i]) return j + 1
  }
  return src.length
}

/** Index of the first character at or after `i` that is not whitespace or a comment. */
function skipTrivia(src: string, i: number): number {
  for (;;) {
    if (/\s/.test(src[i] ?? '')) {
      i++
    } else if (src.startsWith('//', i)) {
      const eol = src.indexOf('\n', i)
      i = eol === -1 ? src.length : eol
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
    } else {
      return i
    }
  }
}

/** Index of the `)` matching the `(` at `open`; parens in strings and comments are ignored. */
function matchParen(src: string, open: number): number {
  let depth = 0
  let i = open
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i)
    } else if (src.startsWith('//', i) || src.startsWith('/*', i)) {
      i = skipTrivia(src, i)
    } else {
      if (c === '(') depth++
      if (c === ')' && --depth === 0) return i
      i++
    }
  }
  return -1
}

/** Every `.from('comments')` chain in `src`, with the method calls that follow it. */
function extractCommentChains(src: string): Chain[] {
  const chains: Chain[] = []
  for (const match of src.matchAll(FROM_COMMENTS)) {
    const calls: Call[] = []
    let i = match.index + match[0].length
    for (;;) {
      i = skipTrivia(src, i)
      NEXT_CALL.lastIndex = i
      const call = NEXT_CALL.exec(src)
      if (!call) break
      const open = i + call[0].length - 1
      const close = matchParen(src, open)
      if (close === -1) break
      calls.push({ name: call[1], args: src.slice(open + 1, close) })
      i = close + 1
    }
    if (calls.length > 0) {
      chains.push({ line: src.slice(0, match.index).split('\n').length, calls })
    }
  }
  return chains
}

function classify(chain: Chain): 'write' | 'ok' | 'unfiltered' {
  if (chain.calls.some((c) => WRITE_METHODS.has(c.name))) return 'write'
  const filtered = chain.calls.some((c) => c.name === 'is' && IS_DELETED_AT_NULL.test(c.args))
  const fetchesColumn = chain.calls.some(
    (c) => c.name === 'select' && /\bdeleted_at\b/.test(c.args)
  )
  return filtered || fetchesColumn ? 'ok' : 'unfiltered'
}

function verdicts(src: string): string[] {
  return extractCommentChains(src).map(classify)
}

// ── Source scan ───────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(full)
    const isSource = /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name)
    return isSource ? [full] : []
  })
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('comments read guard: chain parser', () => {
  it('passes a Prettier-formatted read that filters deleted_at', () => {
    const src = `
      const { data } = await admin
        .from('comments')
        .select(
          'id, content, users!comments_user_id_fkey(full_name)'
        )
        .eq('video_version_id', versionId)
        .is('deleted_at', null)
        .order('timestamp_seconds', { ascending: true })
    `
    const [chain] = extractCommentChains(src)
    assert.deepEqual(
      chain.calls.map((c) => c.name),
      ['select', 'eq', 'is', 'order']
    )
    assert.deepEqual(verdicts(src), ['ok'])
  })

  it('fails a read with no deleted_at filter', () => {
    const src = `admin.from("comments").select('id, content').eq('video_version_id', id)`
    assert.deepEqual(verdicts(src), ['unfiltered'])
  })

  it('passes a read that fetches deleted_at to check it in code', () => {
    const src = `admin.from('comments').select('id, user_id, deleted_at').eq('id', id).single()`
    assert.deepEqual(verdicts(src), ['ok'])
  })

  it('skips write chains', () => {
    const src = `
      await admin.from('comments').update({ deleted_at: now }).eq('id', id).select('id')
      await admin.from('comments').insert({ content }).select('*').single()
      await admin.from('comments').upsert({ id, content })
    `
    assert.deepEqual(verdicts(src), ['write', 'write', 'write'])
  })

  it('is not confused by parens inside quoted strings or by other tables', () => {
    const src = `
      admin.from('comments').select('id').eq('content', 'a)b(').is('deleted_at', null)
      admin.from('comments_archive').select('id')
      admin.from('videos').select('id, deleted_at')
    `
    assert.deepEqual(verdicts(src), ['ok'])
  })

  it('ends the chain at the first non-call token', () => {
    const src = `
      const rows = await admin.from('comments').select('id')
      const other = admin.from('videos').select('deleted_at').is('deleted_at', null)
    `
    assert.deepEqual(verdicts(src), ['unfiltered'])
  })
})

describe('comments read guard: app code', () => {
  const chains = SCAN_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir))).flatMap((file) =>
    extractCommentChains(fs.readFileSync(file, 'utf8')).map((chain) => ({
      ...chain,
      file: path.relative(ROOT, file),
      verdict: classify(chain),
    }))
  )
  const reads = chains.filter((c) => c.verdict !== 'write')

  it(`finds at least ${MIN_READ_CHAINS} read chains (the scan is not vacuous)`, () => {
    assert.ok(
      reads.length >= MIN_READ_CHAINS,
      `expected >= ${MIN_READ_CHAINS} comments read chains under ${SCAN_DIRS.join(', ')}, found ${reads.length}`
    )
  })

  it('every read of comments filters deleted_at or selects it', () => {
    const offenders = reads.filter((c) => c.verdict === 'unfiltered')
    assert.equal(
      offenders.length,
      0,
      [
        `${offenders.length} read(s) of comments neither call .is('deleted_at', null) nor select deleted_at.`,
        'RLS no longer hides soft-deleted comments (migrations 0029/0030, #187), so app code is the only filter:',
        ...offenders.map((c) => `  ${c.file}:${c.line}`),
      ].join('\n')
    )
  })
})
