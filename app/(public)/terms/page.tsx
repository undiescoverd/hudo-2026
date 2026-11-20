/**
 * /terms — Terms of Service (S4-LAUNCH-001). Public route (see PUBLIC_PATHS in middleware.ts).
 *
 * DRAFT: copy is pending approval. Do not treat as in force until approved.
 */
import React from 'react'
import type { Metadata } from 'next'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Terms of Service — Hudo',
}

export default function TermsPage() {
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
          <h1 className="text-3xl font-semibold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Version: DRAFT v0.1</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">1. About these terms</h2>
          <p>
            These terms govern your use of Hudo, a video review platform for talent agencies,
            operated by Resolve Labs Ltd (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an
            account or using Hudo, you agree to these terms and to our{' '}
            <a href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">2. Accounts</h2>
          <p>
            You must give accurate details when you register and keep your password confidential. An
            agency owner is responsible for the members they invite and for the agency&rsquo;s use
            of Hudo.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">3. Roles and review links</h2>
          <p>
            Hudo has five roles: owner, admin agent, agent, talent and guest. Talent users can see
            only their own videos. Guests receive read-only access through review links, which the
            agency can expire or revoke. Guests have no account and no direct access to Hudo&rsquo;s
            database.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">4. Subscriptions and billing</h2>
          <p>
            Paid plans are billed through Stripe, with UK VAT applied where required. Plan limits
            (such as seats and storage) are those shown in the app when you subscribe.
          </p>
          <p className="text-muted-foreground">
            [TBC: renewal, cancellation, refund and founding-member pricing terms.]
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">5. Acceptable use</h2>
          <p>You must not:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>upload content that is unlawful or that infringes someone else&rsquo;s rights;</li>
            <li>try to access another agency&rsquo;s data or bypass access controls;</li>
            <li>scrape, probe or overload the service.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">6. Your content</h2>
          <p>
            You keep ownership of the videos and comments you upload. You grant us the rights needed
            to host, process and display that content solely to provide Hudo to you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">7. Availability</h2>
          <p className="text-muted-foreground">
            [TBC: availability commitment, if any, and service-level terms.]
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">8. Ending your use</h2>
          <p>
            You may stop using Hudo at any time. On termination, we handle your data in line with
            the{' '}
            <a href="/dpa" className="underline underline-offset-4">
              Data Processing Agreement
            </a>
            .
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">9. Liability</h2>
          <p className="text-muted-foreground">
            [TBC: limitation and exclusion of liability, drafted by counsel.]
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">10. Changes</h2>
          <p>
            We may update these terms. We will tell account holders before material changes take
            effect.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">11. Governing law</h2>
          <p>These terms are governed by the laws of England and Wales.</p>
          <p className="text-muted-foreground">[TBC: contact address for legal notices.]</p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
