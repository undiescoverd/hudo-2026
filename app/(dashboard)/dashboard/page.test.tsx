/**
 * /dashboard page — source invariants (node:test + fs.readFileSync pattern).
 * Confirms the merged role-branching dashboard follows the shared
 * error-handling convention on both branches: the server component catches
 * its own data-fetch error and renders the shared <DashboardError /> instead
 * of forwarding an error prop downstream.
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

  it('renders DashboardError on agent-branch fetch error instead of an inline error prop', () => {
    assert.match(source, /error \? <DashboardError \/> : <AgentDashboard/)
  })

  it('does not forward an `error` prop into AgentDashboard', () => {
    assert.doesNotMatch(source, /<AgentDashboard[^>]*error=/)
  })

  it('branches on AGENT_PLUS_ROLES for the agent vs talent split', () => {
    assert.match(source, /AGENT_PLUS_ROLES\.has\(role\)/)
  })

  it('imports getTalentVideos and TalentDashboard for the talent branch', () => {
    assert.match(source, /import \{ getTalentVideos \} from '@\/lib\/talent-dashboard'/)
    assert.match(
      source,
      /import \{ TalentDashboard \} from '@\/components\/dashboard\/TalentDashboard'/
    )
  })

  it('renders DashboardError on talent-branch fetch error instead of bespoke inline markup', () => {
    assert.match(source, /error \? <DashboardError \/> : <TalentDashboard/)
  })

  it('does not forward an `error` prop into TalentDashboard', () => {
    assert.doesNotMatch(source, /<TalentDashboard[^>]*error=/)
  })

  it('logs the underlying error with a unified [dashboard-page] prefix', () => {
    assert.match(source, /console\.error\('\[dashboard-page\] getAgencyVideos failed:'/)
    assert.match(source, /console\.error\('\[dashboard-page\] getTalentVideos failed:'/)
  })

  it('does not log with the old split [talent-page] prefix', () => {
    assert.doesNotMatch(source, /\[talent-page\]/)
  })

  it('no longer redirects to the old separate /talent or /dashboard routes', () => {
    assert.doesNotMatch(source, /redirect\('\/talent'\)/)
    assert.doesNotMatch(source, /redirect\('\/dashboard'\)/)
  })
})
