# Notification Cron Schedule

Current: `0 0 * * *` (daily at midnight UTC)
Desired: `*/5 * * * *` (every 5 minutes)

**Why daily?** The Vercel Hobby plan restricts crons to at most once per day — deployments with
more frequent schedules (including `*/5` and `0 * * * *`) fail at deploy time with a plan-restriction
error. See: https://vercel.com/docs/cron-jobs/usage-and-pricing

**To restore 5-min cadence:** Upgrade the Vercel project to Pro, then update `vercel.json`:
`"schedule": "*/5 * * * *"`

## Storage purge cron

Current: `0 3 * * *` (daily at 03:00 UTC), `/api/cron/storage-purge`.

Drains the `storage_deletions` queue (migration 0024): R2 objects and prefixes queued by the
`purge_*` functions (0025) are deleted, an already-missing key counts as done, and a row that fails
5 times is parked (`attempts >= 5`, reported once to Sentry; inspect `last_error`). Requires
`Authorization: Bearer ${CRON_SECRET}`. Daily is the Hobby-plan ceiling; on Pro it can run hourly.
Ordering caveat: `storage-reconcile` runs at 02:00, before this cron at 03:00. A purge lowers
`storage_usage_bytes` immediately but the R2 bytes linger until the next 03:00 run, so a purge made
earlier in the day can show up as drift (> 1 MiB) in that night's reconcile. Expected, not a bug.
