'use client'

/**
 * LegalEntityForm — collect legal entity data for billing (BILLING-004).
 *
 * Collects legal_name, billing_address (structured), and optional vat_number.
 * Cannot submit without legal_name AND billing_address filled.
 *
 * On save: PATCH /api/agencies/[agencyId]/billing
 * On proceed to checkout: POST /api/agencies/[agencyId]/billing { plan }
 */

import React, { useState } from 'react'
import { Input } from '@/components/ui/input'

export interface BillingAddress {
  line1: string
  line2?: string
  city: string
  postal_code: string
  country: string
}

export interface LegalEntityData {
  legal_name: string
  billing_address: BillingAddress | null
  vat_number?: string
}

export interface LegalEntityFormProps {
  agencyId: string
  initialData?: LegalEntityData
  /** Called when the legal entity data has been successfully saved to the DB. */
  onSaved?: (data: LegalEntityData) => void
}

function isAddressFilled(addr: BillingAddress): boolean {
  return addr.line1.trim() !== '' && addr.city.trim() !== '' && addr.postal_code.trim() !== ''
}

export function LegalEntityForm({ agencyId, initialData, onSaved }: LegalEntityFormProps) {
  const [legalName, setLegalName] = useState(initialData?.legal_name ?? '')
  const [line1, setLine1] = useState(initialData?.billing_address?.line1 ?? '')
  const [line2, setLine2] = useState(initialData?.billing_address?.line2 ?? '')
  const [city, setCity] = useState(initialData?.billing_address?.city ?? '')
  const [postalCode, setPostalCode] = useState(initialData?.billing_address?.postal_code ?? '')
  const [country, setCountry] = useState(initialData?.billing_address?.country ?? 'GB')
  const [vatNumber, setVatNumber] = useState(initialData?.vat_number ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const billingAddress: BillingAddress = {
    line1,
    line2: line2 || undefined,
    city,
    postal_code: postalCode,
    country,
  }

  const canSubmit = legalName.trim() !== '' && isAddressFilled(billingAddress) && !isSaving

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setIsSaving(true)
    setSavedMessage(null)
    setErrorMessage(null)

    const payload: LegalEntityData = {
      legal_name: legalName.trim(),
      billing_address: billingAddress,
      vat_number: vatNumber.trim() || undefined,
    }

    try {
      const res = await fetch(`/api/agencies/${agencyId}/billing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorMessage(body.error ?? 'Failed to save billing details')
        return
      }

      setSavedMessage('Billing details saved.')
      onSaved?.(payload)
    } catch {
      setErrorMessage('Network error — please try again')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-medium">Legal entity details</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Required for invoicing and compliance. Must be completed before upgrading your plan.
        </p>
      </div>

      <div className="space-y-4">
        {/* Legal name */}
        <div className="space-y-1.5">
          <label htmlFor="legal_name" className="text-sm font-medium">
            Legal name{' '}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            Full registered name of your business or organisation.
          </p>
          <Input
            id="legal_name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Acme Talent Ltd"
            required
            aria-required="true"
            autoComplete="organization"
          />
        </div>

        {/* Billing address */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Billing address{' '}
            <span className="text-destructive" aria-hidden="true">
              *
            </span>
          </legend>

          <div className="space-y-1.5">
            <label htmlFor="address_line1" className="text-xs text-muted-foreground">
              Address line 1
            </label>
            <Input
              id="address_line1"
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder="1 High Street"
              required
              aria-required="true"
              autoComplete="address-line1"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="address_line2" className="text-xs text-muted-foreground">
              Address line 2 (optional)
            </label>
            <Input
              id="address_line2"
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              placeholder="Floor 2, Suite 4"
              autoComplete="address-line2"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label htmlFor="address_city" className="text-xs text-muted-foreground">
                City
              </label>
              <Input
                id="address_city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="London"
                required
                aria-required="true"
                autoComplete="address-level2"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="address_postal_code" className="text-xs text-muted-foreground">
                Postcode
              </label>
              <Input
                id="address_postal_code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="SW1A 1AA"
                required
                aria-required="true"
                autoComplete="postal-code"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="address_country" className="text-xs text-muted-foreground">
              Country
            </label>
            <Input
              id="address_country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="GB"
              maxLength={2}
              autoComplete="country"
            />
          </div>
        </fieldset>

        {/* VAT number (optional) */}
        <div className="space-y-1.5">
          <label htmlFor="vat_number" className="text-sm font-medium">
            VAT number <span className="text-muted-foreground font-normal">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Enter your VAT registration number to include it on invoices.
          </p>
          <Input
            id="vat_number"
            value={vatNumber}
            onChange={(e) => setVatNumber(e.target.value)}
            placeholder="GB 123 4567 89"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save details'}
        </button>
      </div>

      {savedMessage && (
        <p role="status" className="text-sm text-green-600">
          {savedMessage}
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
    </form>
  )
}
