# notification-preferences

Per-user settings for email notification delivery.

## Columns

| Column | Type | Notes |
|---|---|---|
| user_id | uuid PK FK → [[users]] | CASCADE delete |
| email_enabled | boolean | Default true |
| batch_window_minutes | integer | `5 \| 15 \| 30 \| 60`; default 15 |

## RLS

| Operation | Policy |
|---|---|
| SELECT | Own row only |
| UPDATE | Own row only |
| INSERT | Own row only |
| DELETE | None |

## Notes

- Row created on first preference change or on user registration (whichever comes first).
- If no row exists, treat as defaults: `email_enabled = true`, `batch_window_minutes = 15`.
- `batch_window_minutes` controls how long the Vercel Cron waits before sending a digest.

## Related tables

- [[users]] — one-to-one
- [[notifications]] — preferences control delivery of these

## Migrations
- `0002_rls_policies`

- `0001_initial_schema`
