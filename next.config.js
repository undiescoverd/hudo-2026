const { withSentryConfig } = require('@sentry/nextjs')

const isDev = process.env.NODE_ENV === 'development'

// Content-Security-Policy directives. Exported so a regression test can assert
// invariants (e.g. R2 host present in both connect-src and media-src) without
// duplicating the string. R2 signed-URL playback requires the R2 host in
// media-src exactly as it does in connect-src for upload PUTs.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // TODO: Replace 'unsafe-inline' with nonce-based CSP in S1
  // 'unsafe-eval' required in dev for Next.js React Fast Refresh (HMR)
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://eu-assets.i.posthog.com" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.i.posthog.com https://*.posthog.com https://*.r2.cloudflarestorage.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: https://*.r2.cloudflarestorage.com",
  "frame-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: CSP_DIRECTIVES.join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  hideSourceMaps: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
})

// Exported for the CSP regression test (next.config.test.ts). Not used by Next.js.
module.exports.CSP_DIRECTIVES = CSP_DIRECTIVES
