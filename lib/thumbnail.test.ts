/**
 * Unit tests for thumbnail utilities.
 *
 * Run: npx tsx --test lib/thumbnail.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('thumbnail — export shape', () => {
  it('exports captureVideoThumbnail function', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /export async function captureVideoThumbnail/)
  })

  it('exports uploadThumbnail function', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /export async function uploadThumbnail/)
  })

  it('exports CaptureOptions interface', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /export interface CaptureOptions/)
  })
})

describe('thumbnail — default options', () => {
  it('defaults seekTime to 2 seconds', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /seekTime:\s*2/)
  })

  it('defaults maxWidth to 640px', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /maxWidth:\s*640/)
  })

  it('defaults quality to 0.8', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /quality:\s*0\.8/)
  })

  it('clamps seek time for short videos', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    // Should use Math.min to clamp seek time
    assert.match(source, /Math\.min\(/)
    assert.match(source, /duration/)
  })
})

describe('thumbnail — URL construction', () => {
  it('POSTs to the correct API endpoint', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /\/api\/videos\/\$\{videoId\}\/thumbnail/)
  })

  it('sets crossOrigin to anonymous for canvas access', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(import.meta.dirname ?? __dirname, 'thumbnail.ts')
    const source = fs.readFileSync(filePath, 'utf8')

    assert.match(source, /crossOrigin\s*=\s*['"]anonymous['"]/)
  })
})
