---
id: S1-PLAYER-002
title: Implement comment keyboard shortcuts
sprint: 1
status: not_started
blocked_by: [S1-PLAYER-001]
tags: [player, keyboard, ux]
---

# S1-PLAYER-002 — Comment keyboard shortcuts

## Files

- `hooks/usePlayerShortcuts.ts`
- `components/player/VideoPlayer.tsx`

## Shortcuts

| Key | Action |
|---|---|
| C | Open comment input at current timestamp |
| I | Set range in-point |
| O | Set range out-point |
| X | Clear in/out points |
| Space | Play/pause |

## Critical

All shortcuts must be disabled when focus is inside any text input or textarea. Check `document.activeElement`.

## Related

- [[S1-PLAYER-001]]
- [[S1-COMMENT-005]] (comment input, depends on this)
