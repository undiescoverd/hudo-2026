---
id: S1-COMMENT-003
title: Build comment UI panel
sprint: 1
status: done
blocked_by: [S1-COMMENT-002, S1-PLAYER-001]
tags: [comments, ui, components]
---

# S1-COMMENT-003 — Build comment UI panel

## Files

- `components/comments/CommentPanel.tsx`
- `components/comments/CommentItem.tsx`
- `components/comments/CommentThread.tsx`

## Behaviours

- Sorted by `timestamp_start` ascending
- Avatar: initials + consistent colour (HSL hash of user UUID)
- Clicking comment seeks player to timestamp
- Resolved: visually muted; unresolved: prominent
- Deleted with replies: `[comment deleted]` placeholder
- Deleted leaf comment: hidden entirely
- Replies nested one level only

## Colour consistency

Same HSL hash approach as the timeline overlay ([[S1-PLAYER-003]]). Must use the same function so the same user gets the same colour in both views.

## Related

- [[S1-COMMENT-002]] [[S1-PLAYER-001]]
- [[S1-COMMENT-004]] (realtime, augments this)
- [[comments]]
