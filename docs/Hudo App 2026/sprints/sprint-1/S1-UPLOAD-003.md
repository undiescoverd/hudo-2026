---
id: S1-UPLOAD-003
title: Build upload UI
sprint: 1
status: done
blocked_by: [S1-UPLOAD-001]
tags: [upload, ui, components]
---

# S1-UPLOAD-003 — Build upload UI

## What it does

Drag-and-drop upload zone with progress tracking for both standard and multipart uploads.

## Files

- `components/upload/UploadZone.tsx`
- `components/upload/UploadProgress.tsx`
- `hooks/useUpload.ts`
- `app/(dashboard)/upload/page.tsx`

## Key behaviours

- Drag-and-drop accepts MP4/MOV; rejects others with clear error
- Progress bar for both standard and multipart
- Error state with retry button
- On success: navigates to new video page
- Mobile: tap to select from camera roll
- Quota exceeded error shown inline (402 from API)

## useUpload hook flow

`presign → upload directly to R2 → poll/confirm`

No video bytes ever hit Vercel.

## Related

- [[S1-UPLOAD-001]] [[S1-UPLOAD-002]]
- [[S1-UPLOAD-005]] (metadata form, unblocked by this)
