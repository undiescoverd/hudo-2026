import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logEvent, type LogEventParams } from './audit.js'

// ---------------------------------------------------------------------------
// Helpers to build stub Supabase clients
// ---------------------------------------------------------------------------

function makeAdminClient(insertError: Error | null = null) {
  const insertStub = mock.fn(async () => ({ error: insertError }))
  const admin = {
    from: mock.fn(() => ({ insert: insertStub })),
    _insertStub: insertStub,
  }
  return admin
}

const BASE_PARAMS: Omit<LogEventParams, 'adminClient'> = {
  action: 'version_uploaded',
  resourceType: 'video',
  resourceId: '00000000-0000-0000-0000-000000000001',
  agencyId: '00000000-0000-0000-0000-000000000002',
  actorId: '00000000-0000-0000-0000-000000000003',
  actorName: 'Alice',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lib/audit — logEvent', () => {
  it('inserts correct payload on success', async () => {
    const admin = makeAdminClient()

    await logEvent({ ...BASE_PARAMS, adminClient: admin as never })

    assert.strictEqual(admin.from.mock.calls.length, 1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.strictEqual((admin.from.mock.calls[0] as any).arguments[0], 'audit_log')
    assert.strictEqual(admin._insertStub.mock.calls.length, 1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted = (admin._insertStub.mock.calls[0] as any).arguments[0] as Record<
      string,
      unknown
    >
    assert.strictEqual(inserted.agency_id, BASE_PARAMS.agencyId)
    assert.strictEqual(inserted.actor_id, BASE_PARAMS.actorId)
    assert.strictEqual(inserted.actor_name, BASE_PARAMS.actorName)
    assert.strictEqual(inserted.action, BASE_PARAMS.action)
    assert.strictEqual(inserted.resource_type, BASE_PARAMS.resourceType)
    assert.strictEqual(inserted.resource_id, BASE_PARAMS.resourceId)
    assert.strictEqual(inserted.metadata, null) // no metadata passed
  })

  it('passes metadata when provided', async () => {
    const admin = makeAdminClient()
    const metadata = { old_status: 'draft', new_status: 'approved' }

    await logEvent({ ...BASE_PARAMS, metadata, adminClient: admin as never })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted = (admin._insertStub.mock.calls[0] as any).arguments[0] as Record<
      string,
      unknown
    >
    assert.deepStrictEqual(inserted.metadata, metadata)
  })

  it('allows null actorId (post-erasure entries)', async () => {
    const admin = makeAdminClient()

    await logEvent({ ...BASE_PARAMS, actorId: null, adminClient: admin as never })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted = (admin._insertStub.mock.calls[0] as any).arguments[0] as Record<
      string,
      unknown
    >
    assert.strictEqual(inserted.actor_id, null)
  })

  it('swallows insert errors — does not throw', async () => {
    const admin = makeAdminClient({ name: 'PostgresError', message: 'connection refused' } as Error)

    // Must resolve, never reject
    await assert.doesNotReject(() => logEvent({ ...BASE_PARAMS, adminClient: admin as never }))
  })

  it('swallows config errors (missing env vars) — does not throw', async () => {
    // Do NOT pass adminClient → forces createAdminClient() which will throw
    // because NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in test env.
    await assert.doesNotReject(() => logEvent(BASE_PARAMS))
  })

  it('console.error is called on insert failure', async () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args)

    const admin = makeAdminClient({ name: 'Err', message: 'timeout' } as Error)

    try {
      await logEvent({ ...BASE_PARAMS, adminClient: admin as never })
    } finally {
      console.error = original
    }

    assert.ok(errors.length > 0, 'console.error must be called on insert failure')
    const msg = String(errors[0])
    assert.ok(msg.includes('[audit:logEvent]'), 'log message must include the module tag')
  })

  it('reports insert failures to Sentry (S3-SEC-006 — compliance-relevant swallowed path)', () => {
    // Behavioural assertion isn't practical here: @sentry/nextjs has no client
    // configured in the test env, and this repo's test runner (`tsx --test`,
    // no --experimental-test-module-mocks) has no established pattern for
    // mocking ESM module imports. Instead, assert the wiring exists in source,
    // matching the source-pattern style already used elsewhere in this suite
    // (see the migration-content test below).
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.resolve(__dirname, './audit.ts'), 'utf8')

    assert.match(source, /import \* as Sentry from '@sentry\/nextjs'/)

    const insertFailureBlock = source.slice(source.indexOf('if (error) {'))
    assert.match(
      insertFailureBlock,
      /Sentry\.captureException\(error/,
      'audit insert failure must be reported to Sentry — this is a compliance-relevant swallowed error'
    )
  })

  it('console.error is called on config error', async () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => errors.push(args)

    try {
      await logEvent(BASE_PARAMS) // no adminClient → createAdminClient() throws in test env
    } finally {
      console.error = original
    }

    assert.ok(errors.length > 0, 'console.error must be called on config error')
  })

  it('migration is indexes-only (confirmed: audit_log table + RLS are pre-existing)', () => {
    // Immutability contract: no update/delete RLS policy was added by this task.
    // The audit_log table has only a SELECT policy for owners/admin_agents (0002_rls_policies.sql).
    // This test validates that expectation via a source check on the migration file.
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const migrationPath = path.resolve(
      __dirname,
      '../supabase/migrations/0017_audit_log_indexes.sql'
    )
    const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()
    assert.ok(!sql.includes('create table'), 'migration must not create a table')
    assert.ok(!sql.includes('create policy'), 'migration must not add RLS policies')
    assert.ok(!sql.includes('alter table'), 'migration must not alter tables')
    assert.ok(
      sql.includes('create index if not exists audit_log_agency_id_idx'),
      'agency_id index must exist'
    )
    assert.ok(
      sql.includes('create index if not exists audit_log_created_at_idx'),
      'created_at index must exist'
    )
  })
})
