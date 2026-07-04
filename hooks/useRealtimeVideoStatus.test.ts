/**
 * Unit tests for useRealtimeVideoStatus.
 *
 * The hook itself requires a browser environment (Realtime subscription via
 * useEffect) which is not available in Node's test runner — no renderer/jsdom
 * is wired into this repo's test setup (see hooks/useNotifications.test.ts).
 * These tests assert the source invariants that make the hook correct:
 * channel/filter construction, the no-op guard, wildcard event subscription
 * (covers INSERT + UPDATE + DELETE), onChange wiring, and cleanup.
 *
 * Run: npx tsx --test "hooks/useRealtimeVideoStatus.test.ts"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('useRealtimeVideoStatus — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const hookPath = path.resolve(currentDir, 'useRealtimeVideoStatus.ts')
    source = fs.readFileSync(hookPath, 'utf8')
  })

  it('is a no-op when agencyId is falsy', () => {
    assert.ok(
      source.includes('if (!agencyId) return'),
      'Effect must bail out early when agencyId is empty/undefined'
    )
  })

  it('channel is scoped per-agency (videos:{agencyId})', () => {
    assert.ok(source.includes('`videos:${agencyId}`'), 'Channel name must be scoped per-agency')
  })

  it('subscribes with an agency_id filter', () => {
    assert.ok(
      source.includes('filter: `agency_id=eq.${agencyId}`'),
      'Realtime filter must use agency_id column'
    )
  })

  it('subscribes to the videos table on the public schema', () => {
    assert.ok(source.includes("table: 'videos'"), 'Must subscribe to the videos table')
    assert.ok(source.includes("schema: 'public'"), 'Must subscribe on the public schema')
  })

  it('listens for all events (covers INSERT + UPDATE + DELETE)', () => {
    assert.ok(
      source.includes("event: '*'"),
      'event must be wildcard so both INSERT and UPDATE payloads (and DELETE) trigger onChange'
    )
  })

  it('invokes onChange on every postgres_changes event', () => {
    assert.ok(
      /\.on\(\s*'postgres_changes'/.test(source) && source.includes('onChange()'),
      'The postgres_changes handler must call onChange()'
    )
  })

  it('removes channel on cleanup (removeChannel called)', () => {
    assert.ok(
      source.includes('supabase.removeChannel(channel)'),
      'useEffect cleanup must remove the Realtime channel'
    )
  })

  it('effect depends on [agencyId, onChange]', () => {
    assert.ok(
      source.includes('}, [agencyId, onChange])'),
      'Subscription effect must re-run when agencyId or onChange changes'
    )
  })
})

describe('VideoStatusLive component — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const componentPath = path.resolve(currentDir, '../components/dashboard/VideoStatusLive.tsx')
    source = fs.readFileSync(componentPath, 'utf8')
  })

  it('accepts an optional onChange callback prop', () => {
    assert.ok(
      source.includes('onChange?: () => void'),
      'onChange prop must be optional so server-component mounts can omit it'
    )
  })

  it('routes the latest onChange through a ref (stable subscription)', () => {
    assert.ok(
      source.includes('onChangeRef.current = onChange'),
      'Latest onChange must be stored in a ref so an inline-unstable callback does not churn the Realtime channel'
    )
    assert.ok(
      source.includes('const cb = onChangeRef.current'),
      'Debounced handler must read the callback from the ref, not close over the prop'
    )
  })

  it('debounced handler identity depends only on router (not onChange)', () => {
    assert.ok(
      source.includes('}, [router])') && !source.includes('}, [router, onChange])'),
      'handleChange useCallback deps must be [router] only — onChange in deps would churn the channel'
    )
  })

  it('falls back to router.refresh() when no onChange is provided', () => {
    assert.ok(
      source.includes('router.refresh()'),
      'Server-component pages rely on router.refresh() as the default refresh strategy'
    )
  })

  it('debounces trailing at ~500ms and clears pending timer', () => {
    assert.ok(source.includes('DEBOUNCE_MS = 500'), 'Debounce must be ~500ms')
    assert.ok(
      source.includes('if (timerRef.current) clearTimeout(timerRef.current)'),
      'Handler must clear the pending timer (trailing debounce) and unmount cleanup must clear it too'
    )
  })

  it('renders null (invisible mount)', () => {
    assert.ok(source.includes('return null'), 'Component must render nothing')
  })
})
