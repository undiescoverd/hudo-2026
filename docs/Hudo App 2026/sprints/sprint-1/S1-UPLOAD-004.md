---
id: S1-UPLOAD-004
title: Implement version upload
sprint: 1
status: done
blocked_by: [S1-UPLOAD-001]
tags: [upload, versioning, rpc]
---

# S1-UPLOAD-004 — Implement version upload

## What it does

`POST /api/videos/:id/versions` creates a new version via the `create_video_version` Postgres RPC.

## Files

- `app/api/videos/[id]/versions/route.ts`
- `supabase/migrations/0005_create_video_version_rpc.sql`

## Key rules

- Version number assigned atomically by RPC — never by app logic
- Talent cannot create versions (403)
- Previous versions always retained
- Rate limited

## Related

- [[S1-UPLOAD-001]]
- [[video-versions]]
- [[ADR-002-version-numbers-via-rpc]]
- [[S1-VERSION-001]] (version selector UI, unblocked by this)
