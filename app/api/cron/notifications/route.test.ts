/**
 * Source-invariant tests for app/api/cron/notifications/route.ts
 * Run: npx tsx --test "app/api/cron/notifications/route.test.ts"
 */
import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('cron/notifications route — source invariants', () => {
  let source: string

  before(() => {
    source = readFileSync(resolve(process.cwd(), 'app/api/cron/notifications/route.ts'), 'utf8')
  })

  it('exports a GET handler', () => {
    assert.match(source, /export async function GET/)
  })

  it('reads CRON_SECRET from environment', () => {
    assert.match(source, /process\.env\.CRON_SECRET/)
  })

  it('checks Authorization header against CRON_SECRET', () => {
    assert.match(source, /authorization.*Bearer.*cronSecret|cronSecret.*Bearer.*authorization/)
  })

  it('returns 401 when auth fails', () => {
    assert.match(source, /status: 401/)
  })

  it('calls batchAndSendNotifications', () => {
    assert.match(source, /batchAndSendNotifications/)
  })

  it('imports batchAndSendNotifications from lib/notifications', () => {
    assert.match(source, /from ['"]@\/lib\/notifications['"]/)
  })
})
