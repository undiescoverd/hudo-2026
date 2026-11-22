import React from 'react'
import type { Metadata } from 'next'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Data Processing Agreement — Hudo',
}

const SUBPROCESSORS = [
  'Supabase',
  'Cloudflare (R2)',
  'Vercel',
  'Stripe',
  'Resend',
  'Upstash',
  'Sentry',
  'PostHog',
]

export default function DpaPage() {
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
          <h1 className="text-3xl font-semibold">Data Processing Agreement</h1>
          <p className="text-sm text-muted-foreground">Last updated: June 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Definitions</h2>
          <p>
            &quot;Data Controller&quot; means the agency using Hudo&apos;s services. &quot;Data
            Processor&quot; means Hudo, the operator of Hudo. &quot;Personal Data&quot; has the
            meaning given in UK GDPR.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Purpose and Scope</h2>
          <p>
            Hudo processes Personal Data on behalf of the Data Controller solely to provide the Hudo
            video review platform and associated services as described in the Terms of Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Instructions</h2>
          <p>
            The Data Processor shall process Personal Data only on the documented instructions of
            the Data Controller, unless required to do so by applicable law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Security</h2>
          <p>
            The Data Processor shall implement appropriate technical and organisational measures to
            ensure a level of security appropriate to the risk, including encryption at rest and in
            transit, access controls, and regular security assessments.
          </p>
        </section>

        <section id="sub-processors" className="space-y-3">
          <h2 className="text-xl font-semibold">5. Sub-processors</h2>
          <p>
            The Data Controller authorises the engagement of sub-processors as listed in Hudo&apos;s
            Sub-processor List, subject to notice of changes. The current sub-processors are:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {SUBPROCESSORS.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Data Subject Rights</h2>
          <p>
            The Data Processor shall assist the Data Controller in fulfilling obligations to respond
            to requests from data subjects exercising their rights under UK GDPR.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Data Retention</h2>
          <p>
            The Data Processor shall delete or return all Personal Data upon termination of
            services, unless applicable law requires retention.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Breach Notification</h2>
          <p>
            The Data Processor shall notify the Data Controller without undue delay after becoming
            aware of a personal data breach.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Governing Law</h2>
          <p>This Agreement is governed by the laws of England and Wales.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Acceptance</h2>
          <p>
            Agency owners accept this agreement in Hudo before a paid plan is activated. By
            accepting, the authorised representative of the Data Controller confirms they have
            authority to bind their organisation and agree to the terms above.
          </p>
          <p>
            Company details and contact: Hudo, [company registration number], [registered address],
            [legal contact email].
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
