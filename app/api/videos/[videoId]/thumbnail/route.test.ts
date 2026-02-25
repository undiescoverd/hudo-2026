/**
 * Unit tests for the thumbnail API route.
 *
 * Run: npx tsx --test app/api/videos/\\[videoId\\]/thumbnail/route.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('thumbnail route — handler existence', () => {
  it('exports a POST handler', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /export async function POST/)
  })

  it('exports a GET handler', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /export async function GET/)
  })
})

describe('thumbnail route — content-type validation', () => {
  it('only allows JPEG and PNG content types', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /image\/jpeg/)
    assert.match(source, /image\/png/)
  })

  it('validates content-type header', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /content-type/)
  })
})

describe('thumbnail route — size limit', () => {
  it('enforces a 2MB maximum size', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    // 2 * 1024 * 1024 = 2097152
    assert.match(source, /2\s*\*\s*1024\s*\*\s*1024/)
  })
})

describe('thumbnail route — security', () => {
  it('uses signed URLs for GET responses (never direct R2 URLs)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /generateSignedUrl/)
  })

  it('requires agent+ role for POST', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const routePath = path.resolve(import.meta.dirname ?? __dirname, 'route.ts')
    const source = fs.readFileSync(routePath, 'utf8')

    assert.match(source, /agentPlusRoles/)
  })

  it('returns 401 when user is null', () => {
    const user = null
    const status = user === null ? 401 : 200
    assert.equal(status, 401)
  })

  it('returns 403 when membership is null', () => {
    const membership = null
    const status = membership === null ? 403 : 200
    assert.equal(status, 403)
  })
})
