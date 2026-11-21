import React from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Privacy Policy — Hudo',
}

const SUBPROCESSORS = [
  { name: 'Supabase', purpose: 'Database, authentication and account data' },
  { name: 'Cloudflare (R2)', purpose: 'Private storage of uploaded video files' },
  { name: 'Vercel', purpose: 'Application hosting and delivery' },
  { name: 'Stripe', purpose: 'Payments, subscriptions and VAT invoicing' },
  { name: 'Resend', purpose: 'Transactional email, such as invitations and notifications' },
  { name: 'Upstash', purpose: 'Rate limiting of sign-in, upload, comment and guest requests' },
  { name: 'Sentry', purpose: 'Error monitoring' },
  { name: 'PostHog', purpose: 'Product analytics, only where you have consented to cookies' },
]

export default function PrivacyPage() {
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
          <h1 className="text-3xl font-semibold">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated: [date of approval]</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Who we are</h2>
          <p>
            This policy explains how [Company legal name] (&quot;we&quot;, &quot;us&quot;) handles
            personal data when you use Hudo. For account and billing data, we are the controller
            under the UK GDPR. Contact: [legal contact email], [Registered address].
          </p>
          <p>
            Where an agency uploads videos or comments about talent, the agency is the controller of
            that content and we process it as its processor. See our{' '}
            <Link className="underline" href="/dpa">
              Data Processing Agreement
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. What we collect</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>Account details: name, work email address, agency name and role.</li>
            <li>Content: videos, versions, comments and approvals that you or your team upload.</li>
            <li>Guest activity: name or details a guest gives when leaving a comment.</li>
            <li>
              Billing details: handled by Stripe. We receive only what we need to run your plan.
            </li>
            <li>Technical data: IP address, browser type and error reports.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. How we use it</h2>
          <p>
            We use personal data to provide Hudo, secure accounts, send service emails, process
            payments, respond to support requests and fix errors. Analytics cookies are used only if
            you accept them. [Lawful bases for each purpose to be confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Cookies</h2>
          <p>
            We use essential cookies to keep you signed in. We set analytics cookies with PostHog
            only after you accept them in the cookie banner. You can change your choice at any time
            by clearing your site data. [Cookie list to be confirmed against the live site.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Who we share it with</h2>
          <p>
            We use the following subprocessors to run Hudo. Each processes personal data only on our
            instructions and under a written agreement.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Subprocessor
                  </th>
                  <th scope="col" className="py-2 font-semibold">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((s) => (
                  <tr key={s.name} className="border-b align-top">
                    <td className="py-2 pr-4">{s.name}</td>
                    <td className="py-2">{s.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Some subprocessors are outside the UK. [Transfer mechanisms, such as the UK
            International Data Transfer Addendum, to be confirmed per subprocessor.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. How long we keep it</h2>
          <p>
            We keep account and content data for as long as your agency has an account. Deleted
            content is removed from storage on a schedule. [Retention periods to be confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Your rights</h2>
          <p>
            You can ask to access, correct, delete or restrict your personal data, or to object to
            or receive a copy of it. Contact us at [legal contact email]. You can also complain to
            the Information Commissioner&apos;s Office at ico.org.uk.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Changes</h2>
          <p>We will update this policy when our practices change and show the new date above.</p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
