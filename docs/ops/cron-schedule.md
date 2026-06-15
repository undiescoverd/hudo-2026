# Notification Cron Schedule

Current: `0 * * * *` (hourly)
Desired: `*/5 * * * *` (every 5 minutes)

**Why hourly?** The Vercel Hobby plan limits cron frequency to at most daily — the `*/5` schedule
caused the preview deployment to fail with a plan-restriction error redirecting to
`/docs/cron-jobs/usage-and-pricing`.

**To restore 5-min cadence:** Upgrade the Vercel project to Pro, then update `vercel.json`:
`"schedule": "*/5 * * * *"`
