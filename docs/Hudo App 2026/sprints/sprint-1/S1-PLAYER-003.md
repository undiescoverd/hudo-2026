---
id: S1-PLAYER-003
title: Build comment timeline overlay
sprint: 1
status: not_started
blocked_by: [S1-PLAYER-001, S1-COMMENT-001]
tags: [player, comments, ui, timeline]
---

# S1-PLAYER-003 — Comment timeline overlay

## Files

- `components/player/CommentTimeline.tsx`
- `components/player/TimelineBadge.tsx`

## Behaviours

- Timeline bar below scrub bar
- Per-user colour-coded badges at comment timestamps
- Range comments span from in to out point
- Overlapping badges stack vertically, reveal on hover
- Clicking a badge seeks player to timestamp + highlights comment in panel

## Colour system

User colour is derived from a HSL hash of `user.id` — not random, not stored. Same function used in comment panel avatars. This ensures the same user always gets the same colour across both views.

## Open question

How to handle dense overlapping comments? Stack limit? Truncate and show "+N more"?

## Related

- [[S1-PLAYER-001]] [[S1-COMMENT-001]]
- [[comments]]
