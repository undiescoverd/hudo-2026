---
id: S1-UPLOAD-005
title: Video metadata form
sprint: 1
status: not_started
blocked_by: [S1-UPLOAD-003]
tags: [upload, ui, metadata]
---

# S1-UPLOAD-005 — Video metadata form

## What it does

Inline form shown after upload success (or on video page) to set title and description.

## Files

- `components/upload/MetadataForm.tsx`
- `app/api/videos/[id]/route.ts`

## Acceptance criteria

- Title required (max 200 chars), description optional (max 2000 chars)
- `PATCH /api/videos/:id` updates title/description
- Talent can edit own video metadata; agents can edit any in agency
- Title defaults to filename if not set

## Related

- [[S1-UPLOAD-003]]
- [[videos]]
