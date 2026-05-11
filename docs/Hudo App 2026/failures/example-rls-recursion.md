---
date: 2025-01-01
area: rls
tags: [rls, memberships, security-definer]
sprint: 0
task: S0-INFRA
---

# [RLS] — Memberships SELECT policy causes infinite recursion

## What broke

Supabase returned a stack overflow / infinite recursion error when any query tried to read from the `memberships` table.

## Root cause

The SELECT policy on `memberships` queried `memberships` to check agency membership — creating a circular dependency:

> To read from memberships → check the policy → policy queries memberships → repeat

## Fix

Created a `SECURITY DEFINER` function `get_current_user_agency_ids()` that reads `memberships` outside the RLS context (as the function owner). Policy now calls this function instead of an inline subquery.

See migration `0003_rls_fix_memberships_recursion.sql`.

## Related

- [[memberships]]
- [[ADR-003-security-definer-rls-fix]]
