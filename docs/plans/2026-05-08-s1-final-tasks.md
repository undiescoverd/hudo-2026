# Sprint 1 Final Tasks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close out Sprint 1 by shipping the two remaining tasks: `S1-COMMENT-005` (comment input with optimistic insert) and `S1-VERSION-002` (version history panel + PATCH active version).

**Architecture:**
- Task A adds a controlled `<CommentInput>` component that posts to the existing comments POST route, renders an optimistic temp-comment immediately (rolled back on error), and reads timestamp/range from the existing `useVideoPlayerContext`.
- Task B adds a `<VersionHistoryPanel>` that consumes the existing `GET /api/videos/:id/versions`, displays version metadata, and extends the existing `PATCH /api/videos/:id` to accept `active_version_id` (agents/admins only — talent gets 403).

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind, Supabase (auth + Postgres + Realtime), Upstash Redis (rate limiting). Tests use `node --test` + `node:assert/strict`.

**Branches:**
- Task A: `feat/s1-comment-005-comment-input`
- Task B: `feat/s1-version-002-version-history`

**Independence:** Tasks A and B touch disjoint files except `components/comments/CommentPanel.tsx` (Task A only) and `app/api/videos/[id]/route.ts` (Task B only). They can run in parallel as separate subagent dispatches.

**Pre-commit gate (every commit):** `pnpm format:check && pnpm type-check && pnpm lint`

---

## Task A — S1-COMMENT-005: Comment Input

**Branch:** `feat/s1-comment-005-comment-input`

**Files:**
- Create: `components/comments/CommentInput.tsx`
- Create: `components/comments/CommentInput.test.tsx`
- Modify: `components/comments/CommentPanel.tsx` (wire CommentInput + optimistic-rollback handler)

**Acceptance criteria (from `tasks/sprint-1.md:329-334`):**
1. Textarea: Enter submits, Shift+Enter inserts newline
2. Shows current player timestamp (point) or in/out range when open
3. 2000 character limit with live counter; submit disabled when over limit
4. Submit disabled when body is empty (after `.trim()`)
5. Optimistic insert: comment appears immediately, reverts on API error

**Design notes:**
- The existing `CommentPanel.handleInsert` dedupes by `id`. We will assign optimistic comments a temp id of the form `temp-${crypto.randomUUID()}` so the real Realtime INSERT (different id) doesn't collide.
- On POST success, we explicitly remove the temp id (Realtime will deliver the real comment shortly; we don't keep both). On POST error, we remove the temp id and surface the error in the input.
- CommentInput reads `currentTime`, `rangeIn`, `rangeOut` from `useVideoPlayerContext()`. If both `rangeIn` and `rangeOut` are non-null and `rangeOut > rangeIn`, the comment is `range`; otherwise `point` at `currentTime`.
- The textarea must have `data-comment-input` (or be a TEXTAREA) so `usePlayerShortcuts` ignores keystrokes — it already filters INPUT/TEXTAREA per `hooks/usePlayerShortcuts.ts`.

### Step A1: Create the failing component test

**File:** `components/comments/CommentInput.test.tsx`

```typescript
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

  it('rolls back optimistic insert on error', () => {
    assert.match(source, /onOptimisticRollback|rollback/i)
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
```

### Step A2: Run the test to verify it fails

```bash
npx tsx --test components/comments/CommentInput.test.tsx
```

Expected: FAIL — `CommentInput.tsx` does not exist (`ENOENT`).

### Step A3: Implement `CommentInput.tsx`

**File:** `components/comments/CommentInput.tsx`

```typescript
'use client'

import { useCallback, useState, type KeyboardEvent } from 'react'
import { COMMENT_BODY_MAX_LENGTH, type Comment } from '@/lib/comments'
import { useVideoPlayerContext } from '@/components/player/VideoPlayer'

interface CommentInputProps {
  videoId: string
  versionId: string
  agencyId: string
  userId: string
  onOptimisticInsert: (comment: Comment) => void
  onOptimisticRollback: (tempId: string) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function CommentInput({
  videoId,
  versionId,
  agencyId,
  userId,
  onOptimisticInsert,
  onOptimisticRollback,
}: CommentInputProps) {
  const player = useVideoPlayerContext()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasRange =
    player.rangeIn !== null &&
    player.rangeOut !== null &&
    player.rangeOut > player.rangeIn
  const commentType: 'point' | 'range' = hasRange ? 'range' : 'point'
  const startSec = hasRange ? (player.rangeIn as number) : player.currentTime
  const endSec = hasRange ? (player.rangeOut as number) : null

  const trimmed = body.trim()
  const overLimit = body.length > COMMENT_BODY_MAX_LENGTH
  const canSubmit = !submitting && trimmed.length > 0 && !overLimit

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setSubmitting(true)

    const tempId = `temp-${crypto.randomUUID()}`
    const nowIso = new Date().toISOString()
    const optimistic: Comment = {
      id: tempId,
      videoVersionId: versionId,
      agencyId,
      userId,
      content: trimmed,
      commentType,
      timestampSeconds: startSec,
      endTimestampSeconds: endSec,
      parentId: null,
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      deletedAt: null,
      createdAt: nowIso,
    }

    onOptimisticInsert(optimistic)
    setBody('')

    try {
      const res = await fetch(
        `/api/videos/${encodeURIComponent(videoId)}/versions/${encodeURIComponent(versionId)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: trimmed,
            comment_type: commentType,
            timestamp_seconds: startSec,
            ...(endSec !== null ? { end_timestamp_seconds: endSec } : {}),
          }),
        }
      )

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `Failed to post comment (${res.status})`)
      }

      // Success: drop the temp; Realtime will deliver the canonical comment.
      onOptimisticRollback(tempId)
    } catch (err) {
      onOptimisticRollback(tempId)
      setError(err instanceof Error ? err.message : 'Failed to post comment')
      setBody(trimmed) // restore so the user can retry
    } finally {
      setSubmitting(false)
    }
  }, [
    canSubmit,
    trimmed,
    commentType,
    startSec,
    endSec,
    versionId,
    videoId,
    agencyId,
    userId,
    onOptimisticInsert,
    onOptimisticRollback,
  ])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const stamp = hasRange
    ? `${formatTime(startSec)} – ${formatTime(endSec as number)}`
    : formatTime(startSec)

  return (
    <div className="border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {stamp}
        </span>
        <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {commentType}
        </span>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="Leave a comment… (Enter to send, Shift+Enter for newline)"
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
      />

      <div className="mt-2 flex items-center justify-between">
        <span
          className={`text-xs ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}
        >
          {body.length} / {COMMENT_BODY_MAX_LENGTH}
        </span>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting…' : 'Post'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
```

### Step A4: Wire CommentInput into CommentPanel

**File:** `components/comments/CommentPanel.tsx` (modify)

Add an optimistic-rollback handler and render the input below the thread list. Replace the file's body to add (and only add) what's necessary; do not change unrelated logic.

Specifically:
1. Import `CommentInput` from `./CommentInput`.
2. Add a new prop `agencyId: string` and `userId: string` to `CommentPanelProps` (the surrounding page already has these from auth/membership context — task scope includes adding them as props).
3. Add `handleOptimisticRollback`:

   ```typescript
   const handleOptimisticRollback = useCallback((tempId: string) => {
     setComments((prev) => prev.filter((c) => c.id !== tempId))
   }, [])
   ```
4. Always render `<CommentInput ... />` at the bottom of the returned JSX, even when the comments list is empty/loading/error. Move the early returns into a wrapping `<div className="flex h-full flex-col">` so the input renders consistently:

   ```tsx
   return (
     <div className="flex h-full flex-col">
       <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
         {/* existing loading / error / empty / topLevel.map block goes here */}
       </div>
       <CommentInput
         videoId={videoId}
         versionId={versionId}
         agencyId={agencyId}
         userId={userId}
         onOptimisticInsert={handleInsert}
         onOptimisticRollback={handleOptimisticRollback}
       />
     </div>
   )
   ```

### Step A5: Run the test to verify it passes

```bash
npx tsx --test components/comments/CommentInput.test.tsx
```

Expected: PASS — all source-invariant tests green.

### Step A6: Run typecheck + lint + format

```bash
pnpm format:check && pnpm type-check && pnpm lint
```

Expected: PASS. If `CommentPanel` callsites elsewhere (e.g. a video page) now miss the new required `agencyId`/`userId` props, fix those callsites in this same task — the task is not done until the type-check is clean. Look for callers via `grep -rn "CommentPanel"` and pass the values from existing auth/membership context on the page.

### Step A7: Commit

```bash
git add components/comments/CommentInput.tsx components/comments/CommentInput.test.tsx components/comments/CommentPanel.tsx
# add any callsite files updated in A6
git commit -m "feat(comments): comment input with optimistic insert — S1-COMMENT-005"
```

### Step A8: Push and open PR

```bash
git push -u origin feat/s1-comment-005-comment-input
gh pr create --title "feat(comments): comment input — S1-COMMENT-005" --body "$(cat <<'EOF'
## Summary
- Adds CommentInput with Enter-to-submit / Shift+Enter for newline
- Optimistic insert via temp id; rolled back on POST failure
- 2000 char limit with live counter; submit gated on trimmed-non-empty
- Reads timestamp/range from useVideoPlayerContext; emits point or range comment

## Test plan
- [ ] `npx tsx --test components/comments/CommentInput.test.tsx`
- [ ] Manual: post a comment, confirm immediate render; flip wifi off, post, confirm rollback + error
- [ ] Manual: set range with I/O keys, confirm input header shows range and POST sends end_timestamp_seconds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then run `/pr-fix` to start the Ralph Loop (per CLAUDE.md).

### Step A9: Mark task done

```bash
# write any gotchas to docs/vault/sprints/sprint-1/S1-COMMENT-005.md under "## Gotchas" first if applicable
node orchestrate.js done S1-COMMENT-005
```

---

## Task B — S1-VERSION-002: Version History Panel

**Branch:** `feat/s1-version-002-version-history`

**Files:**
- Create: `components/versions/VersionHistoryPanel.tsx`
- Create: `components/versions/VersionHistoryPanel.test.tsx`
- Modify: `app/api/videos/[id]/route.ts` (extend PATCH to accept `active_version_id`)
- Modify: `app/api/videos/[id]/route.test.ts` (add source invariants for the new branch)

**Acceptance criteria (from `tasks/sprint-1.md:373-377`):**
1. Panel lists all versions: version number, upload date, uploader name, file size
2. Agents/admins can set any version as active via `PATCH /api/videos/:id`
3. Talent cannot set active version (403)
4. Active version badge clearly indicated

**Design notes:**
- The existing `GET /api/videos/:id/versions` returns `{ id, versionNumber, fileSizeBytes, uploadedBy, createdAt }` only. The acceptance asks for **uploader name**, which the GET does not currently expose. To keep blast radius small: render `uploadedBy` as a stable initials-style avatar/badge plus the user id stub if no name resolver is available, OR if the GET already joins to a profile, use that. **Before implementing, grep `app/api/videos/[id]/versions/route.ts` for any join — if not present, render `uploadedBy` userId only and add a `// TODO: resolve to display name once profiles endpoint exists` comment.** This avoids adding a dependency mid-task.
- The active version is `videos.active_version_id`. The panel needs to know which version is active. Pass it in as a prop (`activeVersionId`) — the parent video page already has it.
- PATCH validation: `active_version_id` must be a UUID and must belong to a `video_versions` row whose `video_id = :id`. Reject otherwise with 400.
- Role gate: agents/admins/owner only. Use `requireAgentRole` from `lib/api-helpers.ts` (per explore report) — do **not** open-code the role list.

### Step B1: Add API source-invariant tests

**File:** `app/api/videos/[id]/route.test.ts` (modify — add a new `describe` block; do not delete existing tests)

```typescript
describe('videos PATCH route — active_version_id branch', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const routePath = path.resolve(currentDir, 'route.ts')
    source = fs.readFileSync(routePath, 'utf8')
  })

  it('accepts active_version_id in PATCH body', () => {
    assert.match(source, /active_version_id/)
  })

  it('uses requireAgentRole to gate active version changes', () => {
    assert.match(source, /requireAgentRole/)
  })

  it('validates the version belongs to this video', () => {
    assert.match(source, /video_versions/)
    assert.match(source, /video_id/)
  })

  it('updates videos.active_version_id', () => {
    assert.match(source, /\.update\([^)]*active_version_id/)
  })
})
```

If `route.test.ts` does not yet exist, create a minimal one mirroring the comments-route test structure, with the imports + the block above.

### Step B2: Add the component test

**File:** `components/versions/VersionHistoryPanel.test.tsx`

```typescript
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('VersionHistoryPanel — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(
      path.resolve(currentDir, 'VersionHistoryPanel.tsx'),
      'utf8'
    )
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('fetches the versions list', () => {
    assert.match(source, /\/api\/videos\/.*\/versions/)
  })

  it('PATCHes active_version_id when an agent sets active', () => {
    assert.match(source, /'PATCH'|"PATCH"/)
    assert.match(source, /active_version_id/)
  })

  it('renders an active badge', () => {
    assert.match(source, /[Aa]ctive/)
  })

  it('hides set-active control for talent role', () => {
    assert.match(source, /role/)
    assert.match(source, /talent/)
  })
})
```

### Step B3: Run the tests to verify they fail

```bash
npx tsx --test components/versions/VersionHistoryPanel.test.tsx app/api/videos/\[id\]/route.test.ts
```

Expected: FAIL — component file missing; PATCH source missing `active_version_id`.

### Step B4: Implement `VersionHistoryPanel.tsx`

**File:** `components/versions/VersionHistoryPanel.tsx`

```typescript
'use client'

import { useCallback, useEffect, useState } from 'react'

interface Version {
  id: string
  versionNumber: number
  fileSizeBytes: number
  uploadedBy: string
  createdAt: string
}

interface VersionHistoryPanelProps {
  videoId: string
  activeVersionId: string | null
  role: 'owner' | 'admin_agent' | 'agent' | 'talent' | 'guest'
  onActiveChanged?: (versionId: string) => void
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function VersionHistoryPanel({
  videoId,
  activeVersionId,
  role,
  onActiveChanged,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const canSetActive = role !== 'talent' && role !== 'guest'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/videos/${encodeURIComponent(videoId)}/versions`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to load versions (${res.status})`)
        }
        return res.json() as Promise<{ versions: Version[] }>
      })
      .then(({ versions: data }) => {
        if (!cancelled) {
          setVersions(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load versions')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const setActive = useCallback(
    async (versionId: string) => {
      setPendingId(versionId)
      setError(null)
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active_version_id: versionId }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to set active (${res.status})`)
        }
        onActiveChanged?.(versionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to set active')
      } finally {
        setPendingId(null)
      }
    },
    [videoId, onActiveChanged]
  )

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Loading versions…</div>
    )
  }

  if (error) {
    return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
  }

  if (versions.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No versions yet.</div>
    )
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {versions.map((v) => {
        const isActive = v.id === activeVersionId
        return (
          <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  v{v.versionNumber}
                </span>
                {isActive && (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Active
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {formatDate(v.createdAt)} · {formatBytes(Number(v.fileSizeBytes))} ·
                uploaded by <span className="font-mono">{v.uploadedBy.slice(0, 8)}</span>
              </div>
            </div>

            {canSetActive && !isActive && (
              <button
                type="button"
                disabled={pendingId === v.id}
                onClick={() => void setActive(v.id)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {pendingId === v.id ? 'Setting…' : 'Set active'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
```

### Step B5: Extend the PATCH handler

**File:** `app/api/videos/[id]/route.ts` (modify)

Add — alongside the existing `title`/`description` branch — handling for `active_version_id`. The exact existing structure should be preserved. Conceptually:

```typescript
// inside the existing PATCH handler, after parsing the body:
const body = (await req.json().catch(() => ({}))) as {
  title?: string
  description?: string
  active_version_id?: string
}

if (body.active_version_id !== undefined) {
  // 1. role gate
  const gated = await requireAgentRole(
    admin,
    user.id,
    video.agency_id,
    'Only agents can set the active version'
  )
  if (gated instanceof NextResponse) return gated

  // 2. UUID shape
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(body.active_version_id)) {
    return NextResponse.json({ error: 'Invalid active_version_id' }, { status: 400 })
  }

  // 3. version belongs to this video
  const { data: version, error: vErr } = await admin
    .from('video_versions')
    .select('id')
    .eq('id', body.active_version_id)
    .eq('video_id', video.id)
    .maybeSingle()

  if (vErr || !version) {
    return NextResponse.json(
      { error: 'Version not found for this video' },
      { status: 400 }
    )
  }

  // 4. update
  const { error: uErr } = await admin
    .from('videos')
    .update({ active_version_id: body.active_version_id, updated_at: new Date().toISOString() })
    .eq('id', video.id)

  if (uErr) {
    return NextResponse.json({ error: 'Failed to update active version' }, { status: 500 })
  }

  return NextResponse.json({ id: video.id, active_version_id: body.active_version_id })
}

// existing title/description path follows unchanged…
```

Read the actual file and adapt the snippet to match its exact variable names (`admin`, `user`, `video`) and its existing flow — do not blindly paste. Preserve the existing rate limit and auth checks.

If `requireAgentRole` is not yet imported, add it: `import { requireAgentRole } from '@/lib/api-helpers'`.

### Step B6: Run tests

```bash
npx tsx --test components/versions/VersionHistoryPanel.test.tsx app/api/videos/\[id\]/route.test.ts
```

Expected: PASS — all source invariants green.

### Step B7: Format / typecheck / lint

```bash
pnpm format:check && pnpm type-check && pnpm lint
```

Expected: PASS.

### Step B8: Commit

```bash
git add components/versions/VersionHistoryPanel.tsx components/versions/VersionHistoryPanel.test.tsx app/api/videos/\[id\]/route.ts app/api/videos/\[id\]/route.test.ts
git commit -m "feat(versions): version history panel + PATCH active version — S1-VERSION-002"
```

### Step B9: Push and open PR

```bash
git push -u origin feat/s1-version-002-version-history
gh pr create --title "feat(versions): version history — S1-VERSION-002" --body "$(cat <<'EOF'
## Summary
- VersionHistoryPanel lists all versions with date/size/uploader and an Active badge
- Agents/admins can set active version; talent role hides the control client-side and is rejected 403 server-side
- Extends PATCH /api/videos/:id with active_version_id (UUID + ownership check)

## Test plan
- [ ] `npx tsx --test components/versions/VersionHistoryPanel.test.tsx app/api/videos/\[id\]/route.test.ts`
- [ ] Manual (agent): set active version, confirm playback URL switches on next load
- [ ] Manual (talent): confirm Set Active button hidden; confirm 403 if PATCH attempted via curl

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then run `/pr-fix` to start the Ralph Loop.

### Step B10: Mark task done

```bash
node orchestrate.js done S1-VERSION-002
```

---

## After both tasks land

1. Sprint 1 is complete (17/17). Run `node orchestrate.js status` to confirm.
2. `node orchestrate.js sync-check` to verify Linear is in sync.
3. Hand-off note: Sprint 2 (dashboards, notifications, guest links) is next.
