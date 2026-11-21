/**
 * Design v3 foundation: palette remap, semantic colours and fonts are wired.
 *
 * Run: npx tsx --test tailwind.config.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import config from './tailwind.config'

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, Record<string, unknown>>
const fonts = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>

describe('tailwind v3 theme', () => {
  it('remaps default scales onto the v3 anchors', () => {
    assert.equal(colors.gray[50], '#f5f5f3')
    assert.equal(colors.gray[200], '#e2e2de')
    assert.equal(colors.gray[900], '#17181b')
    assert.equal(colors.gray[950], '#0f1012')
    assert.equal(colors.blue[600], '#cc3b18')
    assert.equal(colors.blue[700], '#b83514')
    assert.equal(colors.red[700], '#b42318')
    assert.equal(colors.green[700], '#157040')
    assert.equal(colors.amber[700], '#8a5a00')
    assert.equal(colors.yellow[100], '#fbefcf')
  })

  it('exposes semantic colours that read raw vars', () => {
    assert.equal(colors.surface.DEFAULT, 'var(--surface)')
    assert.equal(colors.line, 'var(--line)')
    assert.equal(colors.stage, 'var(--stage)')
    assert.equal(colors.coral.DEFAULT, 'var(--coral)')
    const status = colors.status as unknown as Record<string, { fg: string; bg: string }>
    for (const k of ['draft', 'pending', 'review', 'changes', 'approved']) {
      assert.ok(status[k].fg.startsWith('var(--st-'))
      assert.ok(status[k].bg.startsWith('var(--st-'))
    }
  })

  it('keeps shadcn keys as hsl(var()) wrappers', () => {
    assert.equal((colors.primary as Record<string, string>).DEFAULT, 'hsl(var(--primary))')
  })

  it('wires sans/display/mono fonts from next/font variables', () => {
    assert.match(fonts.sans[0], /--font-sans/)
    assert.match(fonts.display[0], /--font-sans/)
    assert.match(fonts.mono[0], /--font-mono/)
  })

  it('loads Space Grotesk and Space Mono via next/font in the root layout', () => {
    const layout = readFileSync('app/layout.tsx', 'utf8')
    assert.match(layout, /Space_Grotesk/)
    assert.match(layout, /Space_Mono/)
    assert.match(layout, /next\/font\/google/)
    assert.doesNotMatch(layout, /fonts\.googleapis\.com/)
  })
})
