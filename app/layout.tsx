import type { Metadata } from 'next'
import { Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { CookieConsentBanner } from '@/components/cookie-consent-banner'
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register'

// Self-hosted by next/font (no Google Fonts <link>; CSP font-src stays 'self').
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Hudo',
  description: 'Video review platform for talent agencies',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <Providers>
          {children}
          <CookieConsentBanner />
          <ServiceWorkerRegister />
        </Providers>
      </body>
    </html>
  )
}
