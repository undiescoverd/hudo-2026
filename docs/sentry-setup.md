# Sentry Setup

Error monitoring and performance tracking for Hudo.

## Overview

Sentry tracks client-side errors (browser), server-side errors (Node.js), and performance metrics. Set up for **staging** only (prod deferred).

## Prerequisites

- Sentry account in the **Resolve Labs** organization
- Organization slug: `resolve-labs`
- Project: `javascript-nextjs`

## Environment Variables

Five env vars required for Vercel Preview:

```
NEXT_PUBLIC_SENTRY_DSN          # Client-side DSN (public, safe to expose)
SENTRY_DSN                      # Server-side DSN (same as NEXT_PUBLIC_)
SENTRY_AUTH_TOKEN              # For source map uploads in CI/CD
SENTRY_ORG                      # Org slug: resolve-labs
SENTRY_PROJECT                  # Project slug: javascript-nextjs
```

### Getting These Values

1. **DSN** (both client and server use same value):
   - Go to [sentry.io](https://sentry.io/organizations/resolve-labs/projects/javascript-nextjs/)
   - Project settings → "Client Keys (DSN)"
   - Copy the DSN (format: `https://<public_key>@<domain>/<project_id>`)

2. **Auth Token**:
   - Settings (bottom left) → Organization → Auth Tokens
   - Create new token with scopes: `project:releases`, `org:read`
   - Name it `hudo-ci-releases` (or similar)
   - Copy the token

3. **Org & Project**:
   - Org slug: `resolve-labs` (from domain: `resolve-labs.sentry.io`)
   - Project slug: `javascript-nextjs` (from URL path)

## Installation

### 1. Install Dependencies

Already in `package.json`:

```bash
pnpm install
```

### 2. Add to `.env.local` (Local Development)

```bash
NEXT_PUBLIC_SENTRY_DSN=https://<public_key>@<domain>/<project_id>
SENTRY_DSN=https://<public_key>@<domain>/<project_id>
SENTRY_AUTH_TOKEN=sntrys_eyJ...
SENTRY_ORG=resolve-labs
SENTRY_PROJECT=javascript-nextjs
```

### 3. Add to Vercel Preview

```bash
vercel env add NEXT_PUBLIC_SENTRY_DSN preview --force
vercel env add SENTRY_DSN preview --force
vercel env add SENTRY_AUTH_TOKEN preview --force
vercel env add SENTRY_ORG preview --force
vercel env add SENTRY_PROJECT preview --force
```

For each command:
- Paste the value when prompted
- Mark as sensitive: `y`
- Apply to all Preview branches (leave empty)

## Configuration

Sentry is initialized in `instrumentation.ts` (server) and `next.config.js` (client via withSentryConfig).

### Key Settings

- **Consent-gated**: Not yet implemented — see task S0-CODEREVIEW-P1-002. Sentry currently initializes unconditionally on page load.
- **Source maps**: Uploaded during build via `sentry-cli` (requires `SENTRY_AUTH_TOKEN`)
- **Release tracking**: Set to commit SHA for staging/prod deployments
- **Environment**: Set to `staging` for Preview/main branch

## Validation

### Local

Check that Sentry is initialized:

```bash
npm run dev
# Visit localhost:3000 in browser console
# In DevTools → Network, you should see requests to `o4510900833746944.ingest.us.sentry.io`
# (This URL varies by Sentry region)
```

### Staging (Vercel)

After merging to `main` or pushing a feature branch:

1. Deployment completes
2. Visit preview URL (or `main` deployment)
3. In browser console, check for Sentry initialization
4. Any JavaScript errors will appear in [Sentry dashboard](https://sentry.io/organizations/resolve-labs/issues/?project=4510937716293632)

## Troubleshooting

### Auth Token has `=` sign

Normal for Sentry tokens. When adding to Vercel CLI, paste as-is — the CLI handles special characters safely.

### Source maps not uploading

Check:
- `SENTRY_AUTH_TOKEN` is set and valid
- Build log shows `@sentry/cli` output
- Token has `project:releases` scope

### No errors appearing

- Check DSN is correct (copy from Sentry dashboard)
- Verify `NEXT_PUBLIC_SENTRY_DSN` is in Vercel env for Preview
- Check browser console for network errors to Sentry domain

## Future: Production Setup

When ready for v1.0:

1. Create separate Sentry project for production (or use same project with different environment)
2. Add `SENTRY_*` env vars to Vercel Production
3. Update release tracking to use production version scheme
4. Enable additional features: Performance Monitoring, Release Tracking, etc.

## References

- [Sentry Next.js Docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- [Sentry Dashboard](https://sentry.io/organizations/resolve-labs/issues/?project=4510937716293632)
