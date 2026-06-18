'use client'

/**
 * DpaAcceptanceModal — Data Processing Agreement acceptance gate (BILLING-006).
 *
 * Shown to the agency owner before any paid plan activates.
 * The agency owner must explicitly check an acceptance checkbox before proceeding.
 *
 * On accept: POST /api/agencies/[agencyId]/dpa-accept
 * On success: calls onAccepted() so the parent can proceed to checkout.
 */

import React, { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'

const DPA_TEXT = `
Data Processing Agreement

Last updated: June 2026

1. Definitions
"Data Controller" means the agency using Hudo's services. "Data Processor" means Resolve Labs Ltd, the operator of Hudo. "Personal Data" has the meaning given in UK GDPR.

2. Purpose and Scope
Resolve Labs Ltd processes Personal Data on behalf of the Data Controller solely to provide the Hudo video review platform and associated services as described in the Terms of Service.

3. Instructions
The Data Processor shall process Personal Data only on the documented instructions of the Data Controller, unless required to do so by applicable law.

4. Security
The Data Processor shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including encryption at rest and in transit, access controls, and regular security assessments.

5. Sub-processors
The Data Controller authorises the engagement of sub-processors as listed in Hudo's Sub-processor List (available at hudo.io/legal/sub-processors), subject to notice of changes.

6. Data Subject Rights
The Data Processor shall assist the Data Controller in fulfilling obligations to respond to requests from data subjects exercising their rights under UK GDPR.

7. Data Retention
The Data Processor shall delete or return all Personal Data upon termination of services, unless applicable law requires retention.

8. Breach Notification
The Data Processor shall notify the Data Controller without undue delay after becoming aware of a personal data breach.

9. Governing Law
This Agreement is governed by the laws of England and Wales.

By accepting this agreement, the authorised representative of the Data Controller confirms they have authority to bind their organisation and agree to the terms above.
`.trim()

export interface DpaAcceptanceModalProps {
  agencyId: string
  /** Called when DPA has been accepted successfully. */
  onAccepted: () => void
  /** Called when the user dismisses the modal without accepting. */
  onCancel: () => void
}

export function DpaAcceptanceModal({ agencyId, onAccepted, onCancel }: DpaAcceptanceModalProps) {
  const [accepted, setAccepted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleAccept() {
    if (!accepted || isSubmitting) return

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const res = await fetch(`/api/agencies/${agencyId}/dpa-accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorMessage(body.error ?? 'Failed to record acceptance — please try again')
        return
      }

      onAccepted()
    } catch {
      setErrorMessage('Network error — please try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCheckedChange(checked: boolean | 'indeterminate') {
    setAccepted(checked === true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dpa-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-background rounded-lg shadow-lg w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <h2 id="dpa-modal-title" className="text-lg font-semibold">
            Data Processing Agreement
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            You must accept this agreement before activating a paid plan.
          </p>
        </div>

        {/* Scrollable DPA text */}
        <div
          className="flex-1 overflow-y-auto px-6 py-4"
          role="region"
          aria-label="Data Processing Agreement text"
        >
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed">
            {DPA_TEXT}
          </pre>
        </div>

        {/* Acceptance footer */}
        <div className="px-6 py-4 border-t space-y-4">
          {/* Acceptance checkbox */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="dpa_accept"
              checked={accepted}
              onCheckedChange={handleCheckedChange}
              disabled={isSubmitting}
              aria-required="true"
            />
            <label htmlFor="dpa_accept" className="text-sm leading-snug cursor-pointer">
              I confirm I have authority to bind my organisation and agree to the Data Processing
              Agreement above on behalf of my agency.
            </label>
          </div>

          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={!accepted || isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              aria-disabled={!accepted || isSubmitting}
            >
              {isSubmitting ? 'Recording acceptance…' : 'Accept and continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
