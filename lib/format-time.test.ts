/**
 * Unit tests for lib/format-time.ts — shared timecode + relative-time
 * formatting used by the player readout, comment badges, and guest view.
 *
 * Run: npx tsx --test lib/format-time.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Test: formatTimecode
// ---------------------------------------------------------------------------

describe('formatTimecode', () => {
  it('formats 0 seconds as 0:00', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(0), '0:00')
  })

  it('formats 7 seconds as 0:07', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(7), '0:07')
  })

  it('formats 185 seconds as 3:05', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(185), '3:05')
  })

  it('formats 3600 seconds as 1:00:00', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(3600), '1:00:00')
  })

  it('formats 5025 seconds as 1:23:45', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(5025), '1:23:45')
  })

  it('does not zero-pad minutes under an hour', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(65), '1:05')
  })

  it('zero-pads both minutes and seconds at/over an hour', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(3661), '1:01:01')
  })

  it('floors fractional seconds', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(4.2), '0:04')
  })

  it('clamps negative input to 0', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(-10), '0:00')
  })

  it('clamps NaN input to 0', async () => {
    const { formatTimecode } = await import('./format-time')
    assert.equal(formatTimecode(NaN), '0:00')
  })
})

// ---------------------------------------------------------------------------
// Test: formatRelativeTime
// ---------------------------------------------------------------------------

describe('formatRelativeTime', () => {
  it('formats a just-now timestamp', async () => {
    const { formatRelativeTime } = await import('./format-time')
    const iso = new Date(Date.now() - 5_000).toISOString()
    assert.equal(formatRelativeTime(iso), 'just now')
  })

  it('formats ~5 minutes ago', async () => {
    const { formatRelativeTime } = await import('./format-time')
    const iso = new Date(Date.now() - 5 * 60_000).toISOString()
    assert.equal(formatRelativeTime(iso), '5m ago')
  })

  it('formats ~2 hours ago', async () => {
    const { formatRelativeTime } = await import('./format-time')
    const iso = new Date(Date.now() - 2 * 3_600_000).toISOString()
    assert.equal(formatRelativeTime(iso), '2h ago')
  })

  it('formats ~3 days ago', async () => {
    const { formatRelativeTime } = await import('./format-time')
    const iso = new Date(Date.now() - 3 * 86_400_000).toISOString()
    assert.equal(formatRelativeTime(iso), '3d ago')
  })

  it('returns an empty string for an unparseable date', async () => {
    const { formatRelativeTime } = await import('./format-time')
    assert.equal(formatRelativeTime('not-a-date'), '')
  })
})
