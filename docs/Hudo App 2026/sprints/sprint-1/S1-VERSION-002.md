---
id: S1-VERSION-002
title: Version history panel
sprint: 1
status: not_started
blocked_by: [S1-VERSION-001]
tags: [versioning, ui, components]
---

# S1-VERSION-002 — Version history panel

## Files

- `components/versions/VersionHistoryPanel.tsx`
- `app/api/videos/[id]/route.ts`

## Behaviours

- Lists all versions: version number, upload date, uploader name, file size
- Agents/admins can set any version as active (`PATCH /api/videos/:id`)
- Talent cannot set active version (403)
- Active version badge clearly indicated

## Notes

`active_version_id` on [[videos]] determines what the playback-url endpoint serves by default.

## Related

- [[S1-VERSION-001]]
- [[videos]] [[video-versions]]
