import React from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Terms of Service — Hudo',
}

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
        <div
          role="status"
          className="rounded-md border border-amber-500 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <strong>DRAFT — not yet reviewed.</strong> This text has not been approved by the company
          and must not be relied on until it has been reviewed.
        </div>

        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Last updated: [date of approval]</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Who we are</h2>
          <p>
            Hudo is a video review platform for talent agencies, operated by Resolve Labs Ltd,
            registered in England and Wales under company number [Company registration number], with
            its registered office at [Registered address].
          </p>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your use of Hudo. By creating an
            account or using Hudo you agree to these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. The service</h2>
          <p>
            Hudo lets agencies, their staff and their talent upload video, leave timestamped
            comments, resolve comments and approve versions. Agencies can share review links with
            guests, who view content without creating an account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Accounts and agencies</h2>
          <p>
            You must provide accurate information when you register and keep your password secure.
            Each agency account is controlled by its owner, who is responsible for inviting members
            and for the actions of those members. A person may belong to more than one agency, and
            each agency sets its own members and roles.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Acceptable use</h2>
          <p>You must not use Hudo to:</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>upload content you do not have the rights to share;</li>
            <li>share guest review links with people who should not see the content;</li>
            <li>attempt to access another agency&apos;s data or bypass access controls;</li>
            <li>interfere with the service, including by overloading or probing it.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Your content</h2>
          <p>
            You keep ownership of the videos, comments and other material you upload (&quot;Your
            Content&quot;). You give us the limited licence we need to store, process and display
            Your Content in order to provide Hudo to you and the people you invite. [Confirm whether
            Your Content may ever be used for any other purpose, such as AI training.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Subscriptions and payment</h2>
          <p>
            Paid plans are billed in advance through Stripe, monthly or annually, in pounds
            sterling. [VAT treatment to be confirmed.] Plans renew automatically until cancelled.
            [Cancellation, refund and price-change terms to be confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Data protection</h2>
          <p>
            We process personal data in line with our{' '}
            <Link className="underline" href="/privacy">
              Privacy Policy
            </Link>
            . Where we process personal data on an agency&apos;s behalf, the{' '}
            <Link className="underline" href="/dpa">
              Data Processing Agreement
            </Link>{' '}
            applies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Suspension and termination</h2>
          <p>
            You may stop using Hudo at any time. We may suspend or end access if you breach these
            Terms or if we need to do so to protect the service or other users. On termination, Your
            Content is handled as described in the Data Processing Agreement and our Privacy Policy.
            [Retention and deletion periods to be confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Liability</h2>
          <p>
            Nothing in these Terms limits liability for death or personal injury caused by
            negligence, fraud, or anything else that cannot be limited under English law. Subject to
            that, [liability cap and exclusions to be drafted by counsel].
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Changes and governing law</h2>
          <p>
            We may update these Terms and will tell you about material changes. These Terms are
            governed by the laws of England and Wales, and the courts of England and Wales have
            exclusive jurisdiction, subject to any mandatory rights you have as a consumer.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">11. Contact</h2>
          <p>Questions about these Terms: [legal contact email].</p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
