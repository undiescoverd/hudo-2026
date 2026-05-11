# ADR-005 — Comments are soft-delete only

**Status:** Accepted
**Date:** 2025 (S1)

## Decision

Comments can only be soft-deleted by setting `deleted_at`. No hard delete is possible via any API endpoint or RLS policy.

## Why

- Resolved comments are part of the review audit trail — deleting them would break the history
- If a comment has replies, hard-deleting the parent creates orphaned threads
- Agencies need to demonstrate a complete review history for compliance purposes
- Talent cannot silently erase feedback they disagreed with

## Behaviour

| Situation | UI behaviour |
|---|---|
| Comment deleted, no replies | Hidden entirely |
| Comment deleted, has replies | Show `[comment deleted]` placeholder |
| Agent resolves a comment | Visually muted — still visible |

## Enforcement

- No DELETE RLS policy on `comments` — any DELETE attempt by an authenticated client is blocked at DB level
- `DELETE /api/comments/:id` returns 405 Method Not Allowed
- Soft-delete arrives as an UPDATE in Supabase Realtime (setting `deleted_at`) — handled in `useRealtimeComments`
- RLS SELECT policy filters `WHERE deleted_at IS NULL` (migration 0010)

## Related

- [[comments]]
- [[S1-COMMENT-002]] (API enforces 405)
- [[S1-COMMENT-004]] (Realtime handles soft-delete as UPDATE event)
