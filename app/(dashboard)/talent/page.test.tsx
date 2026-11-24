/**
 * /talent is the old URL: it must redirect to /dashboard.
 * Run: pnpm exec tsx "app/(dashboard)/talent/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import TalentPage from './page'

describe('/talent page', () => {
  it('redirects to /dashboard', () => {
    try {
      TalentPage()
      assert.fail('expected a redirect')
    } catch (err) {
      const e = err as { digest?: string; message?: string }
      assert.match(String(e.digest), /^NEXT_REDIRECT/)
      assert.match(String(e.digest), /\/dashboard/)
    }
  })
})
