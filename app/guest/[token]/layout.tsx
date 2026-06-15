/**
 * Guest layout — minimal shell for /guest/[token].
 *
 * Nests inside app/layout.tsx (which wraps in <Providers> + <CookieConsentBanner>).
 * Those components are safe in a private window:
 *   - <Providers> only calls initPostHog() when hasConsent() is true; no consent
 *     cookie exists in a private window → PostHog never initialises.
 *   - <CookieConsentBanner> shows a UI-only banner; makes no Supabase calls.
 *   - No Supabase client is instantiated by any of these providers.
 *
 * The <meta referrer> tag is injected via Next.js metadata export so the
 * token cannot leak via the Referer header on outbound asset requests.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Hudo — Video Review',
  referrer: 'no-referrer',
}

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  // Pass-through: the root layout provides <html>/<body>.
  // We deliberately add no nav, no sidebar, no auth-context providers here.
  return <>{children}</>
}
