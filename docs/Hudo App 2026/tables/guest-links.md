# guest-links

Signed tokens giving external reviewers read-only access to a video. Guests have zero Supabase access — all validation happens server-side.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| video_id | uuid FK → [[videos]] | CASCADE delete |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| video_version_id | uuid FK → [[video-versions]] | Nullable; if set, pins to a specific version |
| token_hash | text UNIQUE | SHA-256 of plaintext token |
| created_by | uuid FK → [[users]] | |
| expires_at | timestamptz | Nullable; no expiry if null |
| revoked_at | timestamptz | Nullable; set to revoke link |
| view_count | integer | Default 0 |
| last_viewed_at | timestamptz | Nullable |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Agents, admin_agents, owners in the agency |
| INSERT | Agents, admin_agents, owners in the agency |
| UPDATE | Agents, admin_agents, owners in the agency (for revocation) |
| DELETE | None |

**No public SELECT policy.** Guests never query this table. Token validated server-side in API routes only.

## Guest access flow

1. Agent calls `POST /api/guest-links` → generates plaintext token → stores SHA-256 hash → returns shareable URL
2. Guest visits `/guest/videos/[videoId]?token=[plaintext]`
3. API hashes token, queries `guest_links` by hash, checks `expires_at` and `revoked_at`
4. On valid match: serve video metadata + comments via service role (bypasses RLS)
5. Guest gets read-only response — no Supabase client, no auth session

## Related tables

- [[videos]] — the video being shared
- [[agencies]] — owner
- [[video-versions]] — optional version pin
- [[users]] — as `created_by`

## Gotchas

- Guests must never receive a Supabase client or session. All guest endpoints use the service role key server-side.
- `revoked_at` is the revocation mechanism. Check both `expires_at` and `revoked_at` in validation.
- `view_count` incremented on each valid token use (analytics for the agency).

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
