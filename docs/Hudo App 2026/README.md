# Hudo Knowledge Vault

Open this folder (`docs/vault/`) as an Obsidian vault.

## Recommended plugins
- **Dataview** — live sprint boards and table queries
- **Obsidian Git** — auto-commit vault changes (optional)

## Structure

| Folder | Contents |
|---|---|
| `tables/` | One note per database table — columns, RLS, gotchas, related tables |
| `sprints/` | One note per sprint task — status, files, gotchas, links |
| `decisions/` | Architecture Decision Records — why things are built the way they are |
| `failures/` | Failure log — what broke, how it was fixed, tagged by area |
| `_templates/` | Templates for new notes — use these when adding new tasks/tables/ADRs |

## Agent workflow

At the end of every task session, Claude Code writes or updates the relevant note in `sprints/sprint-N/`. Any gotcha found mid-task goes in `failures/`. Any new architectural decision goes in `decisions/`.

## Dataview: current sprint status

```dataview
table status, blocked_by, linear
from "sprints/sprint-1"
sort status asc
```
