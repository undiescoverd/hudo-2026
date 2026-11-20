/**
 * /dpa — Data Processing Agreement and sub-processor list (S4-LAUNCH-001).
 * Public route (see PUBLIC_PATHS in middleware.ts). Clauses mirror DPA_TEXT in
 * components/billing/DpaAcceptanceModal.tsx; keep the two in step.
 *
 * DRAFT: copy is pending approval. Do not treat as in force until approved.
 */
import React from 'react'
import type { Metadata } from 'next'
import { LegalFooter } from '@/components/layout/LegalFooter'

export const metadata: Metadata = {
  title: 'Data Processing Agreement — Hudo',
}

/** Sub-processors that process personal data for Hudo. Locations are [TBC] until confirmed. */
const SUB_PROCESSORS = [
  {
    name: 'Supabase',
    purpose: 'Database, authentication and realtime updates',
  },
  {
    name: 'Cloudflare',
    purpose: 'R2 object storage for uploaded video files (accessed through signed URLs)',
  },
  {
    name: 'Vercel',
    purpose: 'Application hosting and serverless functions',
  },
  {
    name: 'Stripe',
    purpose: 'Payments, subscriptions and Stripe Tax (UK VAT)',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email (invitations, notifications, password reset)',
  },
  {
    name: 'Upstash',
    purpose: 'Redis, used for rate limiting',
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring, with tokens and secrets removed before sending',
  },
  {
    name: 'PostHog',
    purpose: 'Product analytics, loaded only after the user accepts analytics cookies',
  },
] as const

const CLAUSES: Array<{ title: string; body: string }> = [
  {
    title: '1. Definitions',
    body: '"Data Controller" means the agency using Hudo\'s services. "Data Processor" means Resolve Labs Ltd, the operator of Hudo. "Personal Data" has the meaning given in UK GDPR.',
  },
  {
    title: '2. Purpose and scope',
    body: 'Resolve Labs Ltd processes Personal Data on behalf of the Data Controller solely to provide the Hudo video review platform and associated services as described in the Terms of Service.',
  },
  {
    title: '3. Instructions',
    body: 'The Data Processor shall process Personal Data only on the documented instructions of the Data Controller, unless required to do so by applicable law.',
  },
  {
    title: '4. Security',
    body: 'The Data Processor shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including encryption at rest and in transit, access controls, and regular security assessments.',
  },
  {
    title: '5. Sub-processors',
    body: 'The Data Controller authorises the engagement of the sub-processors listed below, subject to notice of changes.',
  },
  {
    title: '6. Data subject rights',
    body: 'The Data Processor shall assist the Data Controller in fulfilling obligations to respond to requests from data subjects exercising their rights under UK GDPR.',
  },
  {
    title: '7. Data retention',
    body: 'The Data Processor shall delete or return all Personal Data upon termination of services, unless applicable law requires retention.',
  },
  {
    title: '8. Breach notification',
    body: 'The Data Processor shall notify the Data Controller without undue delay after becoming aware of a personal data breach.',
  },
  {
    title: '9. Governing law',
    body: 'This Agreement is governed by the laws of England and Wales.',
  },
]

export default function DpaPage() {
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
          <h1 className="text-3xl font-semibold">Data Processing Agreement</h1>
          <p className="text-sm text-muted-foreground">Version: DRAFT v0.1</p>
        </header>

        {CLAUSES.map((clause) => (
          <section key={clause.title} className="space-y-2">
            <h2 className="text-lg font-semibold">{clause.title}</h2>
            <p>{clause.body}</p>
          </section>
        ))}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Schedule: sub-processors</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Sub-processor
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Purpose
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Location
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUB_PROCESSORS.map((sp) => (
                  <tr key={sp.name} className="border-b align-top">
                    <td className="py-2 pr-4">{sp.name}</td>
                    <td className="py-2 pr-4">{sp.purpose}</td>
                    <td className="py-2 text-muted-foreground">[TBC]</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Acceptance</h2>
          <p>
            Agency owners accept this agreement when they set up a paid plan. By accepting, the
            authorised representative confirms they can bind their organisation to these terms.
          </p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
