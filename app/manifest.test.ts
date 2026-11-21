import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import manifest from './manifest'

const m = manifest()

describe('app/manifest.ts', () => {
  it('has name, short_name and a same-origin start_url/scope', () => {
    assert.equal(m.name, 'Hudo')
    assert.ok(m.short_name && m.short_name.length <= 12)
    assert.equal(m.start_url, '/')
    assert.equal(m.scope, '/')
  })

  it('is installable: standalone display and theme/background colours', () => {
    assert.equal(m.display, 'standalone')
    assert.match(String(m.theme_color), /^#[0-9a-f]{6}$/i)
    assert.match(String(m.background_color), /^#[0-9a-f]{6}$/i)
  })

  const icons = m.icons ?? []

  it('declares 192 and 512 "any" icons', () => {
    const any = icons.filter((i) => i.purpose === 'any')
    assert.ok(any.some((i) => i.sizes === '192x192'))
    assert.ok(any.some((i) => i.sizes === '512x512'))
  })

  it('declares a maskable 512 icon', () => {
    assert.ok(icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'))
  })

  it('every icon is a PNG under /icons/ and exists in public/', () => {
    assert.ok(icons.length >= 3)
    for (const i of icons) {
      assert.equal(i.type, 'image/png')
      assert.ok(i.src.startsWith('/icons/'), i.src)
      assert.ok(fs.existsSync(path.join(process.cwd(), 'public', i.src)), `missing ${i.src}`)
    }
  })
})
