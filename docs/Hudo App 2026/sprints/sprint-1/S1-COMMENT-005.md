---
id: S1-COMMENT-005
title: Build comment input
sprint: 1
status: not_started
blocked_by: [S1-COMMENT-002, S1-PLAYER-002]
tags: [comments, ui, input]
---

# S1-COMMENT-005 — Build comment input

## Files

- `components/comments/CommentInput.tsx`

## Behaviours

- Enter submits; Shift+Enter inserts newline
- Shows current player timestamp (point) or in/out range when open
- 2000 char limit with live counter; submit disabled when over
- Submit disabled when body is empty
- Optimistic insert: comment appears immediately, reverts on API error

## Integration

Integrates with `useVideoPlayer` context for current timestamp / range state.

## Related

- [[S1-COMMENT-002]] [[S1-PLAYER-002]]
- [[comments]]
