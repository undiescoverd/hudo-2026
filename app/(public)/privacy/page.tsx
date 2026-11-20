/**
 * /privacy — Privacy Policy (S4-LAUNCH-001). Public route (see PUBLIC_PATHS in middleware.ts).
 *
 * DRAFT: copy is pending approval. Do not treat as in force until approved.
 */
import React from 'react'
import type { Metadata } from 'next'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy — Hudo',
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-12">
        <header className="space-y-3">
          <p
            role="status"
            className="inline-block rounded-md border border-amber-500 px-3 py-1 text-xs font-medium text-amber-700"
          >
            DRAFT — pending approval. Not yet in force.
          </p>
          <h1 className="text-3xl font-semibold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Version: DRAFT v0.1</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">1. Who we are</h2>
          <p>
            Hudo is operated by Resolve Labs Ltd. For account and billing data about agency users,
            we act as the controller. For the videos, comments and other content an agency stores in
            Hudo, we act as a processor on the agency&rsquo;s instructions, as set out in our{' '}
            <a href="/dpa" className="underline underline-offset-4">
              Data Processing Agreement
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">2. What we collect</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              Account details: name, email address and a securely hashed password (held by our
              authentication provider).
            </li>
            <li>Agency details and team membership, including invitations.</li>
            <li>Billing details, handled by Stripe. We do not store full card numbers.</li>
            <li>Videos, comments, approvals and notifications you create in Hudo.</li>
            <li>Security and audit records, such as sign-ins and changes to shared content.</li>
            <li>Error reports, with tokens and secrets removed before they are sent.</li>
            <li>Product analytics, only if you accept analytics cookies.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. Why we use it</h2>
          <p>
            To provide Hudo and keep it secure (contract and legitimate interests); to send you
            service emails; to understand product use, only with your consent; and to meet legal and
            tax obligations.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">4. Cookies and similar technology</h2>
          <p>
            Hudo uses essential session cookies to keep you signed in. We do not load analytics
            until you accept. Your choice is stored on your device in local storage, so we can
            remember it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">5. Who we share data with</h2>
          <p>
            We use the sub-processors listed in the{' '}
            <a href="/dpa" className="underline underline-offset-4">
              Data Processing Agreement
            </a>
            . We do not sell personal data.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">6. How long we keep it</h2>
          <p className="text-muted-foreground">
            [TBC: retention periods for account, content, audit and billing records.]
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">7. International transfers</h2>
          <p className="text-muted-foreground">
            [TBC: confirm where each sub-processor stores and processes data, and the transfer
            safeguards relied on.]
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">8. Your rights</h2>
          <p>
            Under the UK GDPR you can ask to access, correct, erase or restrict your data, to
            receive a copy of it, and to object to some processing. Contact us to use these rights.
            You can also complain to the Information Commissioner&rsquo;s Office (ico.org.uk).
          </p>
          <p className="text-muted-foreground">[TBC: privacy contact address.]</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">9. Changes</h2>
          <p>
            We will post changes to this policy here and tell account holders of material changes.
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
