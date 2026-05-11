# notifications

In-app and email notification records. Email is batched; in-app is real-time.

## Columns

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agency_id | uuid FK → [[agencies]] | CASCADE delete |
| recipient_id | uuid FK → [[users]] | CASCADE delete |
| type | text | `new_comment \| comment_resolved \| status_changed \| invitation_accepted` |
| video_id | uuid FK → [[videos]] | Nullable |
| comment_id | uuid FK → [[comments]] | Nullable |
| read_at | timestamptz | Nullable; null = unread |
| created_at | timestamptz | |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Own notifications only (`recipient_id = auth.uid()`) |
| UPDATE | Own notifications only (for marking read) |
| INSERT | Service role only (created by API event handlers) |
| DELETE | None |

## Indexes

- `notifications_recipient_id_idx`

## Email batching

Email delivery is batched per user based on [[notification-preferences]]:
- Window options: 5, 15, 30, or 60 minutes
- Vercel Cron triggers batch digest job
- In-app notifications are not batched — they appear immediately

## Related tables

- [[agencies]] — scope
- [[users]] — as `recipient_id`
- [[videos]] — context
- [[comments]] — context
- [[notification-preferences]] — controls email batch window

## Open questions

- Should in-app notifications use Supabase Realtime? (Cheaper than polling, but adds another subscription.)
- Should unread count badge be derived from this table via Realtime, or via polling?

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
