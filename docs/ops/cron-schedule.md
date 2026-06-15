# Notification Cron Schedule

Current: `0 0 * * *` (daily at midnight UTC)
Desired: `*/5 * * * *` (every 5 minutes)

**Why daily?** The Vercel Hobby plan restricts crons to at most once per day — deployments with
more frequent schedules (including `*/5` and `0 * * * *`) fail at deploy time with a plan-restriction
error. See: https://vercel.com/docs/cron-jobs/usage-and-pricing

**To restore 5-min cadence:** Upgrade the Vercel project to Pro, then update `vercel.json`:
`"schedule": "*/5 * * * *"`
