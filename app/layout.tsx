import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { CookieConsentBanner } from '@/components/cookie-consent-banner'
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register'

export const metadata: Metadata = {
  title: 'Hudo',
  description: 'Video review platform for talent agencies',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
