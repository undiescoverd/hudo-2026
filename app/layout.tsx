import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Hudo',
  description: 'Video review platform for talent agencies',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
