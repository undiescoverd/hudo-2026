/**
 * SignInForm — forgot-password link source invariants (node:test + fs.readFileSync pattern).
 *
 * Run: npx tsx --test "app/auth/signin/signin-form.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('SignInForm — forgot-password link', () => {
  let source: string
  let handler: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'signin-form.tsx'), 'utf8')
    const start = source.indexOf('function handleForgotPasswordClick')
    const end = source.indexOf('async function handleSubmit')
    handler = source.slice(start, end)
  })

  it('links to /auth/forgot-password via next/link', () => {
    assert.match(source, /import Link from 'next\/link'/)
    assert.match(source, /href="\/auth\/forgot-password"/)
    assert.match(source, /Forgot password\?/)
  })

  it('sits after the password input and before the submit button', () => {
    const passwordInput = source.indexOf('id="password"')
    const link = source.indexOf('href="/auth/forgot-password"')
    const submit = source.indexOf('type="submit"')
    assert.ok(passwordInput > -1 && link > passwordInput, 'link follows password input')
    assert.ok(submit > link, 'link precedes the Sign in button')
  })

  it('uses the same link classes as "Create one"', () => {
    assert.match(source, /underline underline-offset-4 hover:text-foreground/)
  })

  it('carries the trimmed email via sessionStorage key hudo:prefill-email', () => {
    assert.match(source, /'hudo:prefill-email'/)
    assert.match(handler, /email\.trim\(\)/)
    assert.match(handler, /sessionStorage\.setItem\(PREFILL_EMAIL_KEY, trimmedEmail\)/)
    assert.match(source, /onClick=\{handleForgotPasswordClick\}/)
  })

  it('wraps storage access in try/catch and does not preventDefault', () => {
    assert.match(handler, /try \{[\s\S]*sessionStorage\.setItem[\s\S]*\} catch/)
    assert.doesNotMatch(handler, /preventDefault/)
  })

  it('never writes the password to storage or the URL', () => {
    assert.doesNotMatch(source, /(?:session|local)Storage\.setItem\([^)]*password/i)
    // Handler body (excluding its own name) must not touch the password state.
    assert.doesNotMatch(handler.replace('handleForgotPasswordClick', ''), /password/i)
    assert.doesNotMatch(source, /forgot-password\?/)
  })
})
