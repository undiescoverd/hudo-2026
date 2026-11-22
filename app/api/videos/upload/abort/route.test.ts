/**
 * abort route: security invariants (repo pattern: node:test + source read, as in the
 * sibling multipart-url route test; the route needs the Next runtime to execute).
 *
 * Run: npx tsx --test app/api/videos/upload/abort/route.test.ts
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('abort route: source invariants', () => {
  let source: string
  before(() => {
    source = fs.readFileSync(path.resolve(here, 'route.ts'), 'utf8')
  })

  it('requires auth before touching storage', () => {
    assert.ok(source.indexOf('auth.getUser()') < source.indexOf('abortMultipartUpload('))
    assert.match(source, /Authentication required/)
    assert.match(source, /status: 401/)
  })

  it('is rate limited with 429 + Retry-After', () => {
    assert.match(source, /rateLimit\(/)
    assert.match(source, /status: 429, headers: \{ 'Retry-After'/)
  })

  it('checks agency membership via the R2 key and restricts talent to their own video', () => {
    assert.match(source, /requireUploadRole\(/)
    assert.match(source, /video\.talent_id !== user\.id/)
    assert.match(source, /video\.agency_id !== agencyId/)
  })

  it('never returns or logs the presigned URL or upload id in errors', () => {
    assert.doesNotMatch(source, /console\.error\([^)]*r2UploadId/)
    assert.doesNotMatch(source, /generatePartUploadUrl/)
  })
})
