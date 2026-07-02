/**
 * AgentDashboard — source invariants (node:test + fs.readFileSync pattern).
 * Tests check the static source to enforce the dashboard error-handling
 * contract without requiring a DOM runtime.
 *
 * Run: npx tsx --test "components/dashboard/AgentDashboard.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('AgentDashboard — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'AgentDashboard.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports an AgentDashboard component', () => {
    assert.match(source, /export function AgentDashboard/)
  })

  it('no longer accepts an initial-load `error` prop — the server page owns that case', () => {
    assert.doesNotMatch(source, /error\?:\s*string/)
    assert.doesNotMatch(source, /AgentDashboard\(\{\s*initialVideos,\s*error\s*\}/)
  })

  it('tracks its own client-side filter-fetch error state', () => {
    assert.match(source, /useState<string \| null>\(null\)/)
    assert.match(source, /setFetchError/)
  })

  it('surfaces a non-ok response as an error instead of swallowing it', () => {
    assert.match(source, /if \(res\.ok\)/)
    assert.match(source, /\} else \{[\s\S]*setFetchError\(/)
  })

  it('surfaces a thrown fetch error instead of swallowing it', () => {
    assert.match(source, /catch \(err\) \{[\s\S]*setFetchError\(/)
  })

  it('clears the fetch error on a subsequent successful fetch', () => {
    assert.match(source, /setFetchError\(null\)/)
  })

  it('renders a retry action for the filter-fetch error', () => {
    assert.match(source, /function handleRetry/)
    assert.match(source, /onClick=\{handleRetry\}/)
    assert.match(source, />\s*Retry\s*</)
  })

  it('renders the fetch error message with an alert role', () => {
    assert.match(source, /role="alert"/)
  })
})
