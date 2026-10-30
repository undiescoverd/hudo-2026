/**
 * ForgotPasswordForm — email prefill source invariants (node:test + fs.readFileSync pattern).
 *
 * Run: npx tsx --test "app/auth/forgot-password/forgot-password-form.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('ForgotPasswordForm — prefill from sign-in', () => {
  let source: string
  let effect: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'forgot-password-form.tsx'), 'utf8')
    const start = source.indexOf('useEffect(')
    const end = source.indexOf('}, [])', start)
    effect = source.slice(start, end)
  })

  it('reads hudo:prefill-email inside a mount-only useEffect (not during render)', () => {
    assert.match(source, /'hudo:prefill-email'/)
    assert.match(source, /import \{ useEffect, useState \} from 'react'/)
    assert.ok(effect.length > 0, 'useEffect with [] deps exists')
    assert.match(effect, /sessionStorage\.getItem\(PREFILL_EMAIL_KEY\)/)
    // The only getItem call is within the effect (no render-time storage read).
    assert.equal(source.match(/sessionStorage\.getItem/g)?.length, 1)
  })

  it('sets the email state and removes the key immediately, inside try/catch', () => {
    assert.match(effect, /setEmail\(prefill\)/)
    assert.match(effect, /sessionStorage\.removeItem\(PREFILL_EMAIL_KEY\)/)
    assert.match(effect, /try \{[\s\S]*\} catch/)
  })

  it('does not submit automatically', () => {
    assert.doesNotMatch(effect, /handleSubmit|fetch\(|requestSubmit|submit\(/)
    assert.doesNotMatch(effect, /setSubmitted|setLoading/)
  })
})
