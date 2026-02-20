---
name: pr-fix
description: Start the Ralph Loop PR review fix cycle. Reads the latest DeepSeek review comment on the current branch's open PR, fixes all findings, pushes, and loops until the review posts Approved. Run this while on the branch that has the open PR.
disable-model-invocation: true
---

Read the file `.claude/pr-fix-loop.md` using the Read tool, then use the Skill tool to invoke `ralph-loop:ralph-loop` with:
- prompt: the exact content of that file
- completion-promise: APPROVED
- max-iterations: 10
