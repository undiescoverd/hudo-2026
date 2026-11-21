/**
 * Unit tests for the video page (app/(dashboard)/videos/[id]/page.tsx).
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source-invariant checks: the comment-panel bootstrap (getUser +
 * versions fetch) must surface a visible error + Retry control instead of
 * silently vanishing on failure, and must not issue a duplicate
 * GET /api/videos/:id/versions request that VersionSelector already needs.
 *
 * Run: npx tsx --test "app/(dashboard)/videos/[id]/page.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('VideoPage — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'page.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a default VideoPage component', () => {
    assert.match(source, /export default function VideoPage/)
  })

  it('only fetches /api/videos/:id/versions once (no duplicate request)', () => {
    const matches = [...source.matchAll(/fetch\(`\/api\/videos\/\$\{params\.id\}\/versions`\)/g)]
    assert.equal(
      matches.length,
      1,
      'the page must fetch the versions endpoint exactly once and hand the result to VersionSelector'
    )
  })

  it('passes the fetched versions down to VersionSelector as a prop', () => {
    assert.match(source, /<VersionSelector[\s\S]*?versions=\{versions\}/)
  })

  it('tracks a bootstrapError state set on getUser or versions failure', () => {
    assert.match(source, /bootstrapError/)
    // Both failure paths must set it — not just console.error it.
    const setErrorCalls = [...source.matchAll(/setBootstrapError\(/g)]
    assert.ok(
      setErrorCalls.length >= 2,
      'setBootstrapError must be called from both the getUser and versions catch blocks'
    )
  })

  it('still logs failures for observability', () => {
    assert.match(source, /console\.error\('\[video-page\] getUser failed:', err\)/)
    assert.match(source, /console\.error\('\[video-page\] agencyId fetch failed:', err\)/)
  })

  it('renders a visible error message in the comment-panel area on bootstrap failure', () => {
    assert.match(source, /bootstrapError \? \(/)
    assert.match(source, /role="alert"/)
  })

  it('renders a Retry control that re-runs the bootstrap fetches', () => {
    assert.match(source, /onClick=\{retryBootstrap\}/)
    assert.match(source, />\s*Retry\s*</)
  })

  it('retryBootstrap re-invokes both fetchUser and fetchVersions', () => {
    const retryFnMatch = source.match(
      /const retryBootstrap = useCallback\(\(\) => \{([\s\S]*?)\}, \[fetchUser, fetchVersions\]\)/
    )
    assert.ok(retryFnMatch, 'retryBootstrap must depend on both fetchUser and fetchVersions')
    const body = retryFnMatch![1]
    assert.match(body, /fetchUser\(\)/)
    assert.match(body, /fetchVersions\(\)/)
    assert.match(body, /setBootstrapError\(null\)/)
  })

  it('only renders CommentPanel when activeVersionId, userId, and agencyId are all present', () => {
    assert.match(source, /activeVersionId && userId && agencyId \? \(/)
  })

  it('passes top-level comments to VideoPlayer so CommentTimeline markers render (replies add none)', () => {
    assert.match(source, /<VideoPlayer[\s\S]*?comments=\{timelineComments\}/)
    assert.match(source, /comments\.filter\(\(c\) => c\.parentId === null\)/)
  })

  it('sources comments from the shared useVideoComments hook (single fetch)', () => {
    assert.match(source, /import \{ useVideoComments \} from '@\/hooks\/useVideoComments'/)
    assert.match(source, /useVideoComments\(params\.id, activeVersionId\)/)
    // The page itself must not fetch the comments endpoint directly — only
    // the shared hook does, so there is exactly one fetch per version.
    assert.doesNotMatch(source, /fetch\(`\/api\/videos\/.*\/comments`\)/)
  })

  it('passes the same comments + mutation handlers to CommentPanel (no second fetch)', () => {
    assert.match(source, /<CommentPanel[\s\S]*?comments=\{comments\}/)
    assert.match(source, /<CommentPanel[\s\S]*?onOptimisticInsert=\{handleCommentInsert\}/)
    assert.match(source, /<CommentPanel[\s\S]*?onOptimisticRollback=\{handleCommentRollback\}/)
  })
})

describe('VideoPage — comment actions wiring (S4-REVIEW-002)', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'page.tsx'), 'utf8')
  })

  it("reads the viewer's role in the video's agency from memberships (RLS, no new API route)", () => {
    assert.match(source, /\.from\('memberships'\)/)
    assert.match(source, /\.select\('role'\)/)
    assert.match(source, /\.eq\('user_id', userId\)/)
    assert.match(source, /\.eq\('agency_id', agencyId\)/)
    assert.doesNotMatch(source, /fetch\(`\/api\/[^`]*role/)
  })

  it('waits for both the user id and the agency id before looking the role up', () => {
    assert.match(source, /if \(!isValidId \|\| !userId \|\| !agencyId\) return/)
  })

  it('logs a failed role lookup and leaves the role null (no actions), not a crash', () => {
    assert.match(source, /console\.error\('\[video-page\] role fetch failed:', err\)/)
    assert.match(source, /setRole\(null\)/)
  })

  it('passes the role and the three comment actions from the hook to CommentPanel', () => {
    assert.match(source, /<CommentPanel[\s\S]*?viewerRole=\{role\}/)
    assert.match(source, /<CommentPanel[\s\S]*?onResolveComment=\{resolveComment\}/)
    assert.match(source, /<CommentPanel[\s\S]*?onEditComment=\{editComment\}/)
    assert.match(source, /<CommentPanel[\s\S]*?onDeleteComment=\{deleteComment\}/)
    assert.match(source, /resolveComment,\s*editComment,\s*deleteComment,\s*\} = useVideoComments/)
  })
})
