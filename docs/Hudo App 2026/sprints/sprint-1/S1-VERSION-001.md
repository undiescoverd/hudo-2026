---
id: S1-VERSION-001
title: Build version selector UI
sprint: 1
status: not_started
blocked_by: [S1-UPLOAD-004]
tags: [versioning, ui, components]
---

# S1-VERSION-001 — Build version selector UI

## Files

- `components/versions/VersionSelector.tsx`
- `app/api/videos/[id]/versions/route.ts` (GET handler)

## Behaviours

- Dropdown or tab strip showing all versions (v1, v2, …)
- Active version highlighted
- Switching version loads that version's signed playback URL + comment list
- `GET /api/videos/:id/versions` returns all versions with number, `created_at`, file size

## Note

The POST handler on the versions route was built in [[S1-UPLOAD-004]]. This task adds the GET handler.

Switching versions must also tear down and recreate the Realtime subscription — see [[S1-COMMENT-004]].

## Related

- [[S1-UPLOAD-004]]
- [[S1-VERSION-002]] (history panel, depends on this)
- [[video-versions]]
