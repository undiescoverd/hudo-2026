# Sprint 1 — Core Product

**Status: In Progress**

**Gate:** An agent invites a talent. Talent uploads a video. Agent opens the player, leaves a point comment and a range comment. Talent sees the comments in real time. Agent resolves a comment. All data is correctly scoped to the agency via RLS.

---

## Tasks

### UPLOAD (5 tasks)

---

- [x] **S1-UPLOAD-001** — Build presigned upload flow

TASK_ID: S1-UPLOAD-001
TITLE: Build presigned upload flow
BRANCH: feat/s1-upload-001-presigned-upload
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - POST /api/videos/upload-url returns a presigned R2 URL for files ≤50MB
  - POST /api/videos/upload-url/multipart initiates multipart upload for files >50MB
  - Server validates content type (MP4/MOV only) and file size (≤10GB) before issuing URL
  - Video bytes never transit Vercel — client uploads directly to R2
  - Rate limiting applied to upload-url endpoint
FILES:
  - app/api/videos/upload-url/route.ts
  - app/api/videos/upload-url/multipart/route.ts
  - app/api/videos/upload-url/multipart/complete/route.ts
NOTES: Foundation for all upload tasks. lib/storage.ts is the only interface to R2.

---

- [x] **S1-UPLOAD-002** — Enforce storage quota at upload

TASK_ID: S1-UPLOAD-002
TITLE: Enforce storage quota at upload
BRANCH: feat/s1-upload-002-storage-quota
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-UPLOAD-001
ACCEPTANCE_CRITERIA:
  - Presign endpoint checks agency storage_used_bytes vs storage_quota_bytes before issuing URL
  - Returns 402 with quota_exceeded error if over limit
  - storage_used_bytes incremented atomically after confirming object exists in R2
  - Decrement on video delete is atomic
FILES:
  - app/api/videos/upload-url/route.ts
  - lib/quota.ts
NOTES: Uses Supabase RPC for atomic increment/decrement to avoid race conditions.

---

- [x] **S1-UPLOAD-003** — Build upload UI

TASK_ID: S1-UPLOAD-003
TITLE: Build upload UI
BRANCH: feat/s1-upload-003-upload-ui
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-UPLOAD-001
ACCEPTANCE_CRITERIA:
  - Drag-and-drop zone accepts MP4/MOV files; rejects others with clear error message
  - Progress bar shows upload % for both standard and multipart uploads
  - Error state shown on failure with retry button
  - On success, navigates to the new video page
  - Mobile: tap to select from camera roll (file input, accept="video/*")
  - Quota exceeded error shown inline (402 from API)
FILES:
  - components/upload/UploadZone.tsx
  - components/upload/UploadProgress.tsx
  - hooks/useUpload.ts
  - app/(dashboard)/upload/page.tsx
NOTES: useUpload hook handles presign → direct R2 upload → poll/confirm. No video bytes hit Vercel.

---

- [x] **S1-UPLOAD-004** — Implement version upload

TASK_ID: S1-UPLOAD-004
TITLE: Implement version upload
BRANCH: feat/s1-upload-004-version-upload
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-UPLOAD-001
ACCEPTANCE_CRITERIA:
  - POST /api/videos/:id/versions creates a new version via create_video_version Postgres RPC
  - RPC increments version number atomically (no race conditions)
  - New version immediately queryable; previous versions retained
  - Talent cannot create versions (403)
  - Rate limiting applied
FILES:
  - app/api/videos/[id]/versions/route.ts
  - supabase/migrations/0005_create_video_version_rpc.sql
NOTES: Version numbers assigned by Postgres RPC only — never by app logic.

---

- [ ] **S1-UPLOAD-005** — Video metadata form

TASK_ID: S1-UPLOAD-005
TITLE: Video metadata form (title/description)
BRANCH: feat/s1-upload-005-metadata-form
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S1-UPLOAD-003
ACCEPTANCE_CRITERIA:
  - Inline form shown after upload success (or on video page) to set title and description
  - Title required (max 200 chars), description optional (max 2000 chars)
  - PATCH /api/videos/:id updates title/description
  - Talent can edit own video metadata; agents can edit any in agency
FILES:
  - components/upload/MetadataForm.tsx
  - app/api/videos/[id]/route.ts
NOTES: Title defaults to filename if not set.

---

### PLAYER (5 tasks)

---

- [x] **S1-PLAYER-001** — Build video player component

TASK_ID: S1-PLAYER-001
TITLE: Build video player component
BRANCH: feat/s1-player-001-video-player
MODEL: opus-4.6
STATUS: done
BLOCKED_BY: S1-UPLOAD-001
ACCEPTANCE_CRITERIA:
  - HTML5 <video> element with native controls fallback
  - Custom control bar: play/pause, scrub timeline, current time / duration display, volume slider, fullscreen
  - Signed URL fetched from GET /api/videos/:id/playback-url — never a direct R2 URL
  - Signed URL auto-refreshed before 15-minute expiry without interrupting playback
  - Player exposes currentTime, duration, seek(t), play(), pause() via ref/context for comment integration
FILES:
  - components/player/VideoPlayer.tsx
  - components/player/PlayerControls.tsx
  - hooks/useVideoPlayer.ts
  - hooks/useSignedUrl.ts
  - app/(dashboard)/videos/[id]/page.tsx
NOTES: Signed URL endpoint already exists (S0-STORAGE-002). Never return or store the raw R2 URL on the client.

---

- [ ] **S1-PLAYER-002** — Implement comment keyboard shortcuts

TASK_ID: S1-PLAYER-002
TITLE: Implement comment keyboard shortcuts
BRANCH: feat/s1-player-002-keyboard-shortcuts
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S1-PLAYER-001
ACCEPTANCE_CRITERIA:
  - C key opens comment input at current timestamp
  - I / O keys set range in/out points
  - X key clears in/out points
  - Space bar plays/pauses
  - All shortcuts disabled when focus is inside any text input or textarea
FILES:
  - hooks/usePlayerShortcuts.ts
  - components/player/VideoPlayer.tsx
NOTES: Shortcuts must not fire inside comment input — check document.activeElement.

---

- [ ] **S1-PLAYER-003** — Build comment timeline overlay

TASK_ID: S1-PLAYER-003
TITLE: Build comment timeline overlay
BRANCH: feat/s1-player-003-timeline-overlay
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S1-PLAYER-001, S1-COMMENT-001
ACCEPTANCE_CRITERIA:
  - Timeline bar (below scrub bar) shows per-user colour-coded badges at comment timestamps
  - Range comments span from In to Out point
  - Overlapping badges stack vertically and reveal on hover
  - Clicking a badge seeks player to that timestamp and highlights the comment in the panel
FILES:
  - components/player/CommentTimeline.tsx
  - components/player/TimelineBadge.tsx
NOTES: User colours: derive consistent colour from user UUID (HSL hash). No external colour library needed.

---

- [ ] **S1-PLAYER-004** — Mobile player layout

TASK_ID: S1-PLAYER-004
TITLE: Mobile player layout
BRANCH: feat/s1-player-004-mobile-layout
MODEL: sonnet-4.6
STATUS: not_started
BLOCKED_BY: S1-PLAYER-001
ACCEPTANCE_CRITERIA:
  - On mobile (<768px): video fills top half of screen, comment panel fills bottom half
  - Persistent comment input bar pinned to bottom
  - Tapping the scrub timeline seeks and opens comment input pre-filled with that timestamp
  - No horizontal scroll at any breakpoint
FILES:
  - components/player/VideoPlayer.tsx
  - components/player/MobilePlayerLayout.tsx
  - app/(dashboard)/videos/[id]/page.tsx
NOTES: Use CSS grid / flex — no JS-based layout switching.

---

- [x] **S1-PLAYER-005** — Video thumbnail generation

TASK_ID: S1-PLAYER-005
TITLE: Video thumbnail generation (client canvas)
BRANCH: feat/s1-player-005-thumbnail
MODEL: haiku-4.5
STATUS: done
BLOCKED_BY: S1-UPLOAD-001
ACCEPTANCE_CRITERIA:
  - After upload completes, capture a frame from the video via client-side canvas
  - Thumbnail uploaded to R2 at videos/{videoId}/thumbnail.jpg
  - videos.thumbnail_url updated in DB
  - Thumbnail shown in video list/card components
FILES:
  - hooks/useUpload.ts
  - lib/thumbnail.ts
NOTES: Use HTMLVideoElement + canvas.toBlob(). Run at ~2s into the video.

---

### COMMENTS (5 tasks)

---

- [x] **S1-COMMENT-001** — Build comment data model

TASK_ID: S1-COMMENT-001
TITLE: Build comment data model
BRANCH: feat/s1-comment-001-data-model
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: none
ACCEPTANCE_CRITERIA:
  - comments table: id, video_version_id, user_id, body, timestamp_start, timestamp_end (nullable), parent_id (nullable), resolved_at, deleted_at, created_at, updated_at
  - RLS: agency members can read all comments on their videos; users can insert own; users can update own body; agents can update resolved_at on agency videos; soft-delete only (no hard delete policy)
  - Indexes on video_version_id, parent_id, deleted_at
FILES:
  - supabase/migrations/0006_comments.sql
NOTES: Hard delete must be blocked at DB level. Soft-delete via deleted_at only.

---

- [x] **S1-COMMENT-002** — Build comment API

TASK_ID: S1-COMMENT-002
TITLE: Build comment API
BRANCH: feat/s1-comment-002-comment-api
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-COMMENT-001
ACCEPTANCE_CRITERIA:
  - GET /api/videos/:id/versions/:versionId/comments returns all non-deleted comments for a version, sorted by timestamp_start
  - POST /api/videos/:id/versions/:versionId/comments creates a comment (point or range)
  - PATCH /api/comments/:id updates body (own comment only) or resolved_at (agents only)
  - DELETE /api/comments/:id soft-deletes (sets deleted_at); hard delete returns 405
  - All endpoints: auth required, agency scoping enforced, rate limited
  - 2000 character body limit enforced server-side
FILES:
  - app/api/videos/[id]/versions/[versionId]/comments/route.ts
  - app/api/comments/[id]/route.ts
  - lib/comments.ts
NOTES: Agents can resolve/unresolve any comment on their agency videos. Talent can only create and soft-delete their own.

---

- [x] **S1-COMMENT-003** — Build comment UI panel

TASK_ID: S1-COMMENT-003
TITLE: Build comment UI panel
BRANCH: feat/s1-comment-003-comment-panel
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-COMMENT-002, S1-PLAYER-001
ACCEPTANCE_CRITERIA:
  - Comment list sorted by timestamp_start ascending
  - Each comment shows avatar (initials + consistent colour), username, timestamp, body
  - Clicking a comment seeks the player to that timestamp
  - Resolved comments visually muted (greyed out); unresolved prominent
  - Deleted comments with replies show "[comment deleted]" placeholder; deleted leaf comments hidden
  - Replies nested under parent (one level only)
FILES:
  - components/comments/CommentPanel.tsx
  - components/comments/CommentItem.tsx
  - components/comments/CommentThread.tsx
NOTES: User colour: same HSL hash approach as timeline overlay. Keep avatar colours consistent across panel and timeline.

---

- [x] **S1-COMMENT-004** — Implement real-time comment sync

TASK_ID: S1-COMMENT-004
TITLE: Implement real-time comment sync
BRANCH: feat/s1-comment-004-realtime
MODEL: sonnet-4.6
STATUS: done
BLOCKED_BY: S1-COMMENT-002
ACCEPTANCE_CRITERIA:
  - Supabase Realtime subscription on comments table filtered to current video_version_id
  - INSERT events append new comment to list without page refresh
  - UPDATE events (resolved, edited body) update comment in place
  - Soft-delete events remove comment from list (or show placeholder if has replies)
  - Subscription torn down on component unmount / version switch
FILES:
  - hooks/useRealtimeComments.ts
  - components/comments/CommentPanel.tsx
NOTES: Realtime channel name: video-version:{videoVersionId}. Scoped per CLAUDE.md requirement.

---

- [ ] **S1-COMMENT-005** — Build comment input

TASK_ID: S1-COMMENT-005
TITLE: Build comment input
BRANCH: feat/s1-comment-005-comment-input
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S1-COMMENT-002, S1-PLAYER-002
ACCEPTANCE_CRITERIA:
  - Textarea: Enter submits, Shift+Enter inserts newline
  - Shows current player timestamp (point) or in/out range when open
  - 2000 character limit with live counter; submit disabled when over limit
  - Submit disabled when body is empty
  - Optimistic insert: comment appears immediately, reverts on API error
FILES:
  - components/comments/CommentInput.tsx
NOTES: Integrates with useVideoPlayer context for current timestamp / range state.

---

### VERSIONING (2 tasks)

---

- [ ] **S1-VERSION-001** — Build version selector UI

TASK_ID: S1-VERSION-001
TITLE: Build version selector UI
BRANCH: feat/s1-version-001-version-selector
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S1-UPLOAD-004
ACCEPTANCE_CRITERIA:
  - Dropdown or tab strip showing all versions for the video (v1, v2, …)
  - Active version highlighted
  - Switching version loads that version's signed playback URL and its comment list
  - GET /api/videos/:id/versions returns all versions with number, created_at, file size
FILES:
  - components/versions/VersionSelector.tsx
  - app/api/videos/[id]/versions/route.ts
NOTES: GET handler on the versions route (POST already handled by S1-UPLOAD-004).

---

- [ ] **S1-VERSION-002** — Version history panel

TASK_ID: S1-VERSION-002
TITLE: Version history panel
BRANCH: feat/s1-version-002-version-history
MODEL: haiku-4.5
STATUS: not_started
BLOCKED_BY: S1-VERSION-001
ACCEPTANCE_CRITERIA:
  - Panel lists all versions: version number, upload date, uploader name, file size
  - Agents/admins can set any version as the active version (PATCH /api/videos/:id)
  - Talent cannot set active version (403)
  - Active version badge clearly indicated
FILES:
  - components/versions/VersionHistoryPanel.tsx
  - app/api/videos/[id]/route.ts
NOTES: Active version determines what playback-url endpoint serves by default.
