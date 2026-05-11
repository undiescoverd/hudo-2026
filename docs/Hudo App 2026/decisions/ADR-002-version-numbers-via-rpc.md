# ADR-002 — Version numbers via Postgres RPC

**Status:** Accepted
**Date:** 2025 (S0)

## Decision

Video version numbers are assigned exclusively by the `create_video_version` Postgres RPC. No application code increments version numbers.

## Why

If two agents upload a new version simultaneously, a `SELECT MAX(version_number) + 1` in app code creates a race condition: both reads see the same MAX, both insert version N+1, and the unique constraint on `(video_id, version_number)` raises a conflict error.

The RPC acquires a row-level lock (`FOR UPDATE` on the parent video row) before reading MAX, making the increment atomic.

## Consequences

- `POST /api/videos/:id/versions` must call the RPC — not insert directly
- The RPC also updates `videos.active_version_id` — don't do this separately
- Any future operation that assigns sequential numbers should use the same pattern

## The RPC

```sql
create_video_version(p_video_id, p_agency_id, p_r2_key, p_file_size_bytes, p_uploaded_by)
```

1. Locks parent video row
2. `SELECT MAX(version_number) + 1`
3. Inserts new `video_versions` row
4. Updates `videos.active_version_id`
5. Returns the new row

## Related

- [[video-versions]]
- [[S1-UPLOAD-004]]
- [[S1-UPLOAD-002]] (same atomic RPC pattern for quota)
