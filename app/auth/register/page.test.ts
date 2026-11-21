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

  it('links the Terms and Privacy Policy under the form (S4-LAUNCH-001)', () => {
    assert.match(source, /By creating an account you agree to the/)
    assert.match(source, /<Link href="\/terms"/)
    assert.match(source, /<Link href="\/privacy"/)
  })
})
