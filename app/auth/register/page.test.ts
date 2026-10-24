import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('RegisterPage — source invariants (S4-JOURNEY-001)', () => {
  let source: string

  before(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(dir, 'page.tsx'), 'utf8')
  })

  it('renders a labelled agency name field', () => {
    assert.match(source, /htmlFor="agencyName"/)
    assert.match(source, /id="agencyName"/)
    assert.match(source, /Agency name is required/)
  })

  it('sends agencyName in the register POST body', () => {
    assert.match(source, /JSON\.stringify\(\{ fullName, agencyName, email, password \}\)/)
  })

  it('session path signs in via /api/auth/signin and lands on /dashboard', () => {
    assert.match(source, /data\.session/)
    assert.match(source, /\/api\/auth\/signin/)
    assert.match(source, /window\.location\.href = '\/dashboard'/)
  })

  it('no-session path shows the check-your-email screen', () => {
    assert.match(source, /setSubmitted\(true\)/)
    assert.match(source, /Check your email/)
  })

  it('success screen is neutral and points existing users to sign in / reset password', () => {
    const start = source.indexOf('if (submitted)')
    const screen = source.slice(start, source.indexOf('return (', start + 20) + 2000)
    assert.match(screen, /is new to Hudo/)
    assert.match(screen, /href="\/auth\/signin"/)
    assert.match(screen, /href="\/auth\/forgot-password"/)
    // Must not reveal whether the address already has an account.
    assert.doesNotMatch(screen, /already (registered|exists|in use)/i)
  })
})
