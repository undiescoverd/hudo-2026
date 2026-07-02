/**
 * /dashboard page — source invariants (node:test + fs.readFileSync pattern).
 * Confirms the agent dashboard follows the shared error-handling convention:
 * the server component catches the fetch error itself and renders the
 * shared <DashboardError /> instead of forwarding an error prop downstream.
 *
 * Run: npx tsx --test "app/(dashboard)/dashboard/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('/dashboard page — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'page.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('imports the shared DashboardError component', () => {
    assert.match(
      source,
      /import \{ DashboardError \} from '@\/components\/dashboard\/DashboardError'/
    )
  })

  it('renders DashboardError on fetch error instead of an inline error prop', () => {
    assert.match(source, /error \? <DashboardError \/> : <AgentDashboard/)
  })

  it('does not forward an `error` prop into AgentDashboard', () => {
    assert.doesNotMatch(source, /<AgentDashboard[^>]*error=/)
  })

  it('logs the underlying error for observability', () => {
    assert.match(source, /console\.error\('\[dashboard-page\]/)
  })
})
