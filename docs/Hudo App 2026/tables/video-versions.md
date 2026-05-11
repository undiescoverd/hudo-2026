# video-versions

Each upload creates a new version. All versions are retained forever — no version is ever deleted.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| video_id | uuid FK → [[videos]] | CASCADE delete |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| version_number | integer | Assigned by RPC only — never app logic |
| r2_key | text | The Cloudflare R2 object key |
| file_size_bytes | bigint | Used for quota tracking |
| duration_seconds | integer | Nullable; populated post-upload |
| uploaded_by | uuid FK → [[users]] | |
| created_at | timestamptz | |

**Unique constraint:** `(video_id, version_number)` — prevents duplicate version numbers.

## RLS

| Operation | Policy |
|---|---|
| SELECT | Agents/owners: all in agency; Talent: versions of own videos only |
| INSERT | Agents/owners only |
| UPDATE | None |
| DELETE | None |

## Indexes

- `video_versions_video_id_idx`

## Related tables

- [[videos]] — parent
- [[agencies]] — owner
- [[users]] — as `uploaded_by`
- [[comments]] — comments are scoped to a version, not a video

## Version numbering — critical

Version numbers are assigned exclusively by the `create_video_version` Postgres RPC:
1. RPC locks the parent video row (`FOR UPDATE`)
2. Queries `MAX(version_number)` for that video
3. Inserts with `MAX + 1`
4. Updates `videos.active_version_id` to the new version

This prevents race conditions when two agents upload simultaneously. See [[ADR-002-version-numbers-via-rpc]].

## Gotchas

- `r2_key` is the internal R2 object path. Never expose it to clients. Playback always goes through the signing proxy (`/api/videos/:id/playback-url`).
- Comments are attached to `video_version_id`, not `video_id`. When switching versions, the comment list changes entirely.

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
