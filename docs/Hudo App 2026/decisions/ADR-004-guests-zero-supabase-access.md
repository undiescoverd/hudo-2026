# ADR-004 — Guests have zero Supabase access

**Status:** Accepted
**Date:** 2025 (S0)

## Decision

External reviewers (guests) never receive a Supabase client, session, or anon key access. All guest data is served exclusively through API routes that validate the guest token server-side using the service role key.

## Why

- Granting anon access to guests would require RLS policies that handle unauthenticated reads — significantly more complex and error-prone
- Token-based guest links are easier to audit (view count, revocation, expiry)
- Service role access in API routes keeps the security boundary clear: guest token validity is a server concern only
- Prevents accidental client-side queries against Supabase by guest-facing code

## Guest flow

1. Agent generates a link with a plaintext token → SHA-256 hash stored in `guest_links`
2. Guest visits `/guest/videos/[videoId]?token=[plaintext]`
3. API hashes the token, queries `guest_links` by hash, checks `expires_at` and `revoked_at`
4. Valid: serve video + comments via service role (RLS bypassed server-side)
5. Response is read-only; no write endpoints for guests

## Consequences

- No Supabase client in any guest-facing component
- Guest API routes use `createClient(SUPABASE_URL, SERVICE_ROLE_KEY)` — never the anon key
- `guest_links` has no public SELECT RLS policy — only agents+ can query it
- The guest token plaintext must only ever appear in the URL and the invitation email — never in the DB

## Related

- [[guest-links]]
- [[ADR-001-video-never-touches-vercel]] (same "nothing bypasses the proxy" philosophy)
