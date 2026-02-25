# Vercel Setup

Three fully isolated environments: `hudo-dev`, `hudo-staging`, `hudo-prod` — each with own Supabase project, R2 bucket, Vercel env group, Stripe key. No production secrets in dev.

## Project

**Resolve Labs / hudo-2026** (`info-75594398s-projects`). Region: `lhr1` (London).

## Environments

| Vercel environment | Branch | Hudo environment | Env vars |
|---|---|---|---|
| **Preview** | `main` + all feature branches | staging | staging Supabase, R2, Redis |
| **Production** | `production` (reserved for v1.0) | prod | staging values (placeholder) |

- **Never deploy to production** (`vercel --prod`) or push to `production` branch. Production deploys require explicit owner approval.
- All development work goes through Preview deployments via pushes to `main` or feature branches.
- CLI scope: `info-75594398s-projects` (Resolve Labs). Run `vercel switch` if on wrong scope.
- Env vars managed via `vercel env add <NAME> preview --force`. Local env files (`.env.local`, `.env.staging`) are gitignored.
