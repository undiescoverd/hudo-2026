/**
 * /guest/invalid — static page shown when a guest token is invalid,
 * expired, or has been revoked. No data fetch, no token in the URL.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Link Invalid — Hudo',
  referrer: 'no-referrer',
}

export default function GuestInvalidPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <div className="max-w-md space-y-3 rounded-[14px] border border-line bg-surface p-8">
        <span className="text-xl font-semibold tracking-tight text-gray-900">hudo</span>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
          This link is no longer valid
        </h1>
        <p className="text-sm text-gray-600">
          This review link is invalid, has expired, or has been revoked. Please ask the person who
          shared it with you for a new link.
        </p>
      </div>
    </div>
  )
}
