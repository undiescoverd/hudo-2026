# comments

Timestamped feedback on a specific video version. Soft-delete only — no hard delete ever.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| video_version_id | uuid FK → [[video-versions]] | CASCADE delete |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| user_id | uuid FK → [[users]] | Author |
| content | text | Max 2000 chars (DB constraint) |
| comment_type | text | `point \| range` |
| timestamp_seconds | numeric | Start timestamp |
| end_timestamp_seconds | numeric | Nullable; range comments only |
| parent_id | uuid FK → comments | Nullable; max depth 1 |
| resolved | boolean | Default false |
| resolved_at | timestamptz | Nullable |
| resolved_by | uuid FK → [[users]] | Nullable |
| deleted_at | timestamptz | Soft delete — the only form of deletion |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | All agency members, including soft-deleted rows |
| INSERT | All agency members (own `user_id` only) |
| UPDATE | Own comment; Agents+ can update any comment in their agency |
| DELETE | **No policy** — hard delete is blocked at RLS level |

Note: The RLS SELECT policy deliberately does **not** filter `deleted_at` (GitHub #187 option b, migration `0029_comments_select_keep_soft_deleted`). A soft delete is an UPDATE that sets `deleted_at`, and Supabase Realtime checks each subscriber's SELECT policy against the new row, so an RLS filter would stop other viewers receiving the soft-delete event. App code hides soft-deleted comments instead: every read of `comments` filters `.is('deleted_at', null)` or checks `deleted_at !== null`. Accepted trade-off: soft-deleted comment text stays readable to the comment's own agency through direct supabase-js reads and the Realtime payload. Migration 0004 added the filter but was never applied to the live DBs; 0029 drops it so the repo and CI match live.

## Indexes

- `comments_video_version_id_idx`
- `comments_resolved_idx`

## Realtime

Supabase Realtime subscription channel: `video-version:{videoVersionId}`

Scoped to `video_version_id` — **not** `video_id`. Switching video versions must tear down and recreate the subscription. See hook: `hooks/useRealtimeComments.ts`.

## Related tables

- [[video-versions]] — parent
- [[agencies]] — owner
- [[users]] — as `user_id` and `resolved_by`
- [[notifications]] — as `comment_id`

## Soft-delete behaviour

- Leaf comment deleted → hide entirely from UI
- Comment with replies deleted → show `[comment deleted]` placeholder, keep replies
- `deleted_at` set via `PATCH /api/comments/:id` — the DELETE HTTP method returns 405

## Gotchas

- Never add a hard DELETE RLS policy to this table. The spec requires an immutable audit trail of comment activity.
- 2000 char limit is enforced at both DB level (`CHECK`) and API level. Client shows live counter.
- Max nesting depth is 1. `parent_id` must refer to a comment with `parent_id IS NULL`.

## Migrations
- `0002_rls_policies`- `0004_rls_comments_soft_delete_filter`- `0010_fix_comments_soft_delete`- `0029_comments_select_keep_soft_deleted`



- `0001_initial_schema`
