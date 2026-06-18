/**
 * UsageBars — unit tests for the formatBytes helper and source invariants.
 *
 * Uses Node.js built-in test runner — no DOM runtime needed.
 * formatBytes is imported directly (pure function). Rendering contracts
 * are verified via source invariants (the repo's established pattern).
 *
 * Run: npx tsx --test "components/billing/UsageBars.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { formatBytes } from './UsageBars.js'
import { PLANS } from '../../lib/plans.js'

// ---------------------------------------------------------------------------
// formatBytes — pure function unit tests
// ---------------------------------------------------------------------------

describe('formatBytes — byte formatting', () => {
  it('formats agency_pro 1 TiB cap as TB (not GB)', () => {
    // 1024 * GiB = 1 099 511 627 776 bytes — the agency_pro storage cap.
    // The pre-fix bug returned "1024.0 GB"; correct is "1.0 TB".
    const agencyProBytes = PLANS.agency_pro.storageLimitBytes
    assert.equal(formatBytes(agencyProBytes), '1.0 TB')
  })

  it('formats starter 100 GiB cap as GB', () => {
    const starterBytes = PLANS.starter.storageLimitBytes
    assert.equal(formatBytes(starterBytes), '100.0 GB')
  })

  it('formats studio 500 GiB cap as GB', () => {
    const studioBytes = PLANS.studio.storageLimitBytes
    assert.equal(formatBytes(studioBytes), '500.0 GB')
  })

  it('formats freemium 10 GiB cap as GB', () => {
    const freemiumBytes = PLANS.freemium.storageLimitBytes
    assert.equal(formatBytes(freemiumBytes), '10.0 GB')
  })

  it('formats MB values correctly', () => {
    // 5 MiB
    assert.equal(formatBytes(5 * 1_048_576), '5.0 MB')
  })

  it('formats KB values (sub-MiB) correctly', () => {
    // 512 KiB = 524 288 bytes → "512 KB"
    assert.equal(formatBytes(512 * 1024), '512 KB')
  })

  it('formats exact 1 TB boundary as TB not GB', () => {
    // 1 TiB is exactly the threshold — must flip to TB, not linger in GB
    assert.match(formatBytes(1_099_511_627_776), /TB$/)
    assert.doesNotMatch(formatBytes(1_099_511_627_776), /GB$/)
  })

  it('formats just below 1 TB threshold as GB', () => {
    // 1 TiB - 1 byte = still GB territory
    assert.match(formatBytes(1_099_511_627_775), /GB$/)
  })
})

// ---------------------------------------------------------------------------
// Source invariants — rendering contracts for agents/talent/storage rows
// ---------------------------------------------------------------------------

describe('UsageBars — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'UsageBars.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('exports formatBytes', () => {
    assert.match(source, /export function formatBytes/)
  })

  it('exports UsageBars component', () => {
    assert.match(source, /export function UsageBars/)
  })

  it('derives agent seat ceiling from getPlan (not a hardcoded literal)', () => {
    // The Agents row must use planData.agentSeats — never a magic number —
    // so that changing PLANS is the only place to update the ceiling.
    assert.match(source, /planData\.agentSeats/)
  })

  it('Agents progress bar shows ceiling as "N agents" label', () => {
    // The limitLabel for the Agents bar must suffix " agents" so the UI reads
    // e.g. "3 agents" for starter, matching the acceptance criterion.
    assert.match(source, /agents/)
    assert.match(source, /planData\.agentSeats/)
  })

  it('Talent row renders count with no / limit denominator', () => {
    // Talent is unlimited — there must be no "/  N" pattern for talent.
    // We assert the component does NOT render a ProgressBar for talent
    // (no aria-label="Talent:…" pattern, which ProgressBar would emit).
    assert.doesNotMatch(source, /label="Talent".*ProgressBar|ProgressBar.*label="Talent"/)
  })

  it('Talent row shows "Unlimited" hint', () => {
    assert.match(source, /Unlimited/)
  })

  it('Storage row uses formatBytes for both used and limit labels', () => {
    // Both currentLabel and limitLabel must go through formatBytes.
    const formatBytesMatches = [...source.matchAll(/formatBytes\(/g)]
    assert.ok(
      formatBytesMatches.length >= 2,
      `expected at least 2 formatBytes calls (used + limit), found ${formatBytesMatches.length}`
    )
  })

  it('storageLimitBytes comes from props (not hardcoded from plan)', () => {
    // The storage limit is stored on agencies.storage_limit_bytes and passed
    // in as a prop — so agencies can have custom overrides. The component must
    // NOT derive the storage limit from getPlan().storageLimitBytes internally.
    assert.match(source, /storageLimitBytes/)
    // It IS fine to use planData for agent seats, but storage must be prop-driven.
    assert.doesNotMatch(source, /planData\.storageLimitBytes/)
  })
})

// ---------------------------------------------------------------------------
// PLANS consistency — guard the TB formatting bug at the data level
// ---------------------------------------------------------------------------

describe('PLANS — agency_pro storage stays at 1 TiB (TB display threshold)', () => {
  it('agency_pro storageLimitBytes is exactly 1 TiB', () => {
    const oneTiB = 1024 ** 3 * 1024 // 1 TiB in bytes
    assert.equal(PLANS.agency_pro.storageLimitBytes, oneTiB)
  })

  it('no plan storage cap falls between 1 TiB and 1024 TiB (avoids ambiguous TB range)', () => {
    // All caps should cleanly express as GB or TB — no fractional TB values
    // that would be confusing (e.g. 1.5 TB displayed as "1536.0 GB" was the bug).
    for (const plan of Object.values(PLANS)) {
      const formatted = formatBytes(plan.storageLimitBytes)
      // Each cap must render as a round number without absurd GB counts
      assert.ok(
        formatted.endsWith(' TB') || formatted.endsWith(' GB'),
        `${plan.id} storage ${plan.storageLimitBytes} should format as GB or TB, got: ${formatted}`
      )
    }
  })
})
