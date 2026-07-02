/**
 * /talent page — source invariants (node:test + fs.readFileSync pattern).
 * Confirms the talent dashboard uses the same shared <DashboardError />
 * convention as /dashboard, rather than its own inline error markup.
 *
 * Run: npx tsx --test "app/(dashboard)/talent/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('/talent page — source invariants', () => {
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

  it('renders DashboardError on fetch error instead of bespoke inline markup', () => {
    assert.match(source, /error \? <DashboardError \/> : <TalentDashboard/)
  })

  it('no longer hardcodes its own error paragraph', () => {
    assert.doesNotMatch(source, /Unable to load videos right now\. Please try again later\./)
  })

  it('logs the underlying error for observability', () => {
    assert.match(source, /console\.error\('\[talent-page\]/)
  })
})
