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
          <p className="text-sm text-muted-foreground">Last updated: [date of approval]</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">1. Parties and definitions</h2>
          <p>
            This agreement applies between the agency using Hudo (the &quot;Controller&quot;) and
            [Company legal name] (the &quot;Processor&quot;), which operates Hudo. Terms such as
            &quot;personal data&quot;, &quot;processing&quot; and &quot;data subject&quot; have the
            meanings given in the UK GDPR.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">2. Scope and purpose</h2>
          <p>
            The Processor processes personal data on behalf of the Controller only to provide the
            Hudo video review platform, as described in the Terms of Service. The subject matter,
            duration, nature and purpose of processing, and the types of personal data and data
            subjects, are described in Schedule 1. [Schedule 1 to be completed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">3. Instructions</h2>
          <p>
            The Processor processes personal data only on the Controller&apos;s documented
            instructions, unless the law requires otherwise. Using Hudo as intended is an
            instruction.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">4. Security</h2>
          <p>
            The Processor applies appropriate technical and organisational measures, including
            encryption in transit and at rest, private storage with time-limited signed links,
            access controls based on agency membership, and an audit log of key actions. [Security
            measures to be confirmed against the live system.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">5. Subprocessors</h2>
          <p>
            The Controller authorises the Processor to use the following subprocessors, and the
            Processor will impose data protection terms on each that are equivalent to these:
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {SUBPROCESSORS.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p>
            The Processor will give the Controller notice before adding or replacing a subprocessor,
            and the Controller may object on reasonable grounds. [Notice period to be confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">6. Data subject rights</h2>
          <p>
            The Processor will help the Controller respond to requests from data subjects, including
            requests for access, correction and erasure, within a reasonable time.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">7. Breach notification</h2>
          <p>
            The Processor will notify the Controller without undue delay after becoming aware of a
            personal data breach affecting the Controller&apos;s data. [Notification timescale to be
            confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">8. Deletion and return</h2>
          <p>
            When the services end, the Processor will delete or return the Controller&apos;s
            personal data, unless the law requires it to be kept. [Deletion timescale to be
            confirmed.]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">9. Audits and records</h2>
          <p>
            The Processor will make available the information reasonably needed to show compliance
            with this agreement and will allow reasonable audits on written request.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">10. Acceptance and governing law</h2>
          <p>
            Agency owners accept this agreement in Hudo before a paid plan is activated. This
            agreement is governed by the laws of England and Wales.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">11. Contact</h2>
          <p>Questions about this agreement: [legal contact email].</p>
        </section>
      </main>
      <LegalFooter />
    </div>
  )
}
