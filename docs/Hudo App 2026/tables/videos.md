# videos

The central product entity. Each video belongs to one agency and one talent user.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| talent_id | uuid FK → [[users]] | The talent who owns this video |
| title | text | Editable; defaults to filename at upload |
| status | text | See workflow below |
| active_version_id | uuid FK → [[video-versions]] | Nullable; updated by `create_video_version` RPC |
| created_at | timestamptz | |
| updated_at | timestamptz | |

## Status workflow

```
draft → pending_review → in_review → changes_requested → approved
```

- **Talent** can only move to `pending_review`
- **Agents/owners** can move to `in_review`, `changes_requested`, `approved`
- Status transitions are enforced at the API layer, not via DB constraint

## RLS

| Operation | Policy |
|---|---|
| SELECT | Agents/owners: all in agency; Talent: own videos only |
| INSERT | Agents/owners only |
| UPDATE | Agents/owners: any in agency; Talent: own video only |
| DELETE | None |

## Indexes

- `videos_agency_id_idx`

## Related tables

- [[agencies]] — owner
- [[users]] — as `talent_id`
- [[video-versions]] — version history; `active_version_id` points to current
- [[notifications]] — as `video_id`
- [[guest-links]] — as `video_id`
- [[audit-log]] — as `resource_id` for status changes

## Gotchas

- `active_version_id` is updated automatically by the `create_video_version` RPC — don't update it manually from app logic.
- Video bytes never stored in Supabase. Only metadata lives here. See [[ADR-001-video-never-touches-vercel]].

## Migrations
- `0002_rls_policies`- `0009_videos_thumbnail_r2_key`


- `0001_initial_schema`
