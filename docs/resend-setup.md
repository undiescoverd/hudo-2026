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

**Verified domain: `hudoapp.com`** (Resend, eu-west-1). Staging (Vercel Preview) sends from `noreply@hudoapp.com` as of 2026-11-23.

Still to do: check `RESEND_FROM_EMAIL` on **Production** and **Development** and set it to `noreply@hudoapp.com` if it is still `onboarding@resend.dev` (Resend's sandbox sender, which only delivers to the Resend account owner). Use `--no-sensitive` so the value stays readable by `vercel env pull`:

```bash
vercel env rm RESEND_FROM_EMAIL production --yes
printf '%s' 'noreply@hudoapp.com' | vercel env add RESEND_FROM_EMAIL production --no-sensitive
```

A leftover `hudoapp.com` entry in ap-northeast-1 (status Not Started) can be deleted from the Resend dashboard; `tdhagency.com` on the same account is a different business and must not be used for Hudo email.

## API Keys

One key is currently shared across all environments. When approaching production:
- Create separate keys in [resend.com/api-keys](https://resend.com/api-keys) named `hudo-dev`, `hudo-staging`, `hudo-prod`
- Use `sending_access` permission, scoped to `hudoapp.com` once verified
- Update each Vercel environment separately:
  ```bash
  printf '%s' "re_..." | vercel env add RESEND_API_KEY development --no-sensitive
  printf '%s' "re_..." | vercel env add RESEND_API_KEY preview --no-sensitive
  printf '%s' "re_..." | vercel env add RESEND_API_KEY production --no-sensitive
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
