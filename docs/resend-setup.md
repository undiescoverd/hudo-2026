# Resend Setup Guide

Resend handles all transactional email: invitations, notifications, and future password-reset flows.

## Environment Variables

Two vars required in every environment:

| Var | Purpose |
|-----|---------|
| `RESEND_API_KEY` | Secret key from Resend dashboard |
| `RESEND_FROM_EMAIL` | Sender address for all outbound email |

Both are set in Vercel and pulled locally via `vercel env pull .env.local --yes`.

## Sender Address

**No custom domain yet:** use `onboarding@resend.dev` — pre-verified by Resend, works immediately across all environments.

**Once `hudo.app` is purchased:**
1. Go to [resend.com/domains](https://resend.com/domains) → Add Domain → `hudo.app`
2. Add the DNS records Resend provides (SPF, DKIM, DMARC)
3. Wait for verification (usually minutes)
4. Update `RESEND_FROM_EMAIL` in Vercel to `noreply@hudo.app` for all environments

## API Keys

One key is currently shared across all environments. When approaching production:
- Create separate keys in [resend.com/api-keys](https://resend.com/api-keys) named `hudo-dev`, `hudo-staging`, `hudo-prod`
- Use `sending_access` permission, scoped to `hudo.app` domain once verified
- Update each Vercel environment separately:
  ```bash
  echo "re_..." | vercel env add RESEND_API_KEY development
  echo "re_..." | vercel env add RESEND_API_KEY preview
  echo "re_..." | vercel env add RESEND_API_KEY production
  ```

## Local Development

After any Vercel env change:

```bash
vercel env pull .env.local --yes
```

The invitation route has a graceful fallback — if `RESEND_API_KEY` is missing locally it logs the invite URL to the console instead of throwing, so email is not required for local dev.

## Where It's Used

- `lib/email.ts` — `sendEmail()` wrapper (instantiates Resend per-call, not at module scope)
- `app/api/invitations/send/route.ts` — invitation emails

See `lib/email.ts` for implementation.
