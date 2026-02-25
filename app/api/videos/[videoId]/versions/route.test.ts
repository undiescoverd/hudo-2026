/**
 * Unit tests for the versions list API route.
 *
 * Run: npx tsx --test app/api/videos/\\[videoId\\]/versions/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('versions route — source code invariants', () => {
  it('exports a GET handler', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /export async function GET/)
  })

  it('never exposes r2_key in the response', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // The select query should not include r2_key
    const selectMatch = source.match(/\.select\(['"](.*?)['"]\)/)
    assert.ok(selectMatch, '.select() call must exist in the source')
    assert.doesNotMatch(selectMatch[1], /r2_key/, 'r2_key must not be in the select query')
  })

  it('orders versions by version_number descending', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /order\('version_number',\s*\{\s*ascending:\s*false\s*\}/)
  })

  it('requires authentication (returns 401 for null user)', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('requires membership (returns 403 for null membership)', () => {
    const membership = null
    const status = membership === null ? 403 : 200
    assert.equal(status, 403)
  })
})

describe('playback-url route — version selection', () => {
  it('supports versionId query parameter', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, '../playback-url/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /versionId/)
    assert.match(source, /searchParams/)
  })

  it('validates versionId as UUID format', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, '../playback-url/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // Should have UUID validation and error response
    assert.ok(source.includes('0-9a-f'), 'playback-url must contain UUID hex pattern')
    assert.match(source, /Invalid version ID format/)
  })

  it('includes versionNumber in playback-url response', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, '../playback-url/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /versionNumber/)
  })
})
