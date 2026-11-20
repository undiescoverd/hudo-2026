# Notification Cron Schedule

Current: `0 0 * * *` (daily at midnight UTC)
Desired: `*/5 * * * *` (every 5 minutes)

**Why daily?** The Vercel Hobby plan restricts crons to at most once per day — deployments with
more frequent schedules (including `*/5` and `0 * * * *`) fail at deploy time with a plan-restriction
error. See: https://vercel.com/docs/cron-jobs/usage-and-pricing

**To restore 5-min cadence:** Upgrade the Vercel project to Pro, then update `vercel.json`:
`"schedule": "*/5 * * * *"`

## Storage purge cron

Current: `0 1 * * *` (daily at 01:00 UTC), `/api/cron/storage-purge`.

Drains the `storage_deletions` queue (migration 0024): R2 objects and prefixes queued by the
`purge_*` functions (0025) are deleted, an already-missing key counts as done, and a row that fails
5 times is parked (`attempts >= 5`, reported once to Sentry; inspect `last_error`). Requires
`Authorization: Bearer ${CRON_SECRET}`. Daily is the Hobby-plan ceiling; on Pro it can run hourly.
Ordering: the purge runs at 01:00, before `storage-reconcile` at 02:00. A purge lowers
`storage_usage_bytes` immediately but the R2 bytes stay until the drain, so reconcile running first
would report that gap as drift (> 1 MiB) every night after a delete. Remaining caveats: rows that
fail or are parked at max attempts keep their R2 bytes (reconcile will flag them), and a purge made
between 01:00 and 02:00 shows as drift in that night's reconcile.
