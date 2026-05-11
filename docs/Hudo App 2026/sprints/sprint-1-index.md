# Sprint 1 — Core Product

**Status:** In Progress
**Gate:** An agent invites a talent. Talent uploads a video. Agent opens the player, leaves a point comment and a range comment. Talent sees the comments in real time. Agent resolves a comment. All data is correctly scoped to the agency via RLS.

---

## Dataview — live status board

```dataview
table status, blocked_by
from "sprints/sprint-1"
where id != null
sort status asc
```

---

## Tasks

### Upload
| Task | Title | Status |
|---|---|---|
| [[S1-UPLOAD-001]] | Build presigned upload flow | done |
| [[S1-UPLOAD-002]] | Enforce storage quota | done |
| [[S1-UPLOAD-003]] | Build upload UI | done |
| [[S1-UPLOAD-004]] | Implement version upload | done |
| [[S1-UPLOAD-005]] | Video metadata form | not_started |

### Player
| Task | Title | Status |
|---|---|---|
| [[S1-PLAYER-001]] | Build video player component | done |
| [[S1-PLAYER-002]] | Comment keyboard shortcuts | not_started |
| [[S1-PLAYER-003]] | Comment timeline overlay | not_started |
| [[S1-PLAYER-004]] | Mobile player layout | not_started |
| [[S1-PLAYER-005]] | Video thumbnail generation | done |

### Comments
| Task | Title | Status |
|---|---|---|
| [[S1-COMMENT-001]] | Build comment data model | done |
| [[S1-COMMENT-002]] | Build comment API | done |
| [[S1-COMMENT-003]] | Build comment UI panel | done |
| [[S1-COMMENT-004]] | Real-time comment sync | done |
| [[S1-COMMENT-005]] | Build comment input | not_started |

### Versioning
| Task | Title | Status |
|---|---|---|
| [[S1-VERSION-001]] | Version selector UI | not_started |
| [[S1-VERSION-002]] | Version history panel | not_started |
