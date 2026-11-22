/**
 * Unit tests for VersionSelector component.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source-invariant checks, in particular the "controlled" versions
 * prop that lets a parent (the video page) pass down an already-fetched
 * versions list so VersionSelector doesn't duplicate the
 * GET /api/videos/:id/versions request.
 *
 * Run: npx tsx --test "components/versions/VersionSelector.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('VersionSelector — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'VersionSelector.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports the Version type for callers that pre-fetch it', () => {
    assert.match(source, /export interface Version/)
  })

  it('accepts an optional controlled `versions` prop', () => {
    assert.match(source, /versions\?: Version\[\] \| null/)
  })

  it('skips its own network fetch when running in controlled mode', () => {
    assert.match(source, /const isControlled = controlledVersions !== undefined/)
    assert.match(source, /if \(isControlled\) return/)
  })

  it('still fetches the versions endpoint when uncontrolled (backward compatible)', () => {
    assert.match(source, /fetch\(`\/api\/videos\/\$\{videoId\}\/versions`\)/)
  })

  it('auto-selects the latest version in both controlled and uncontrolled modes', () => {
    const matches = [...source.matchAll(/onVersionChange\(/g)]
    assert.ok(
      matches.length >= 2,
      'onVersionChange must be invoked for auto-select in both fetch modes'
    )
  })

  it('shows a loading state without fetching while the controlled data is still null', () => {
    assert.match(source, /controlledVersions === null/)
  })
})

// ---------------------------------------------------------------------------
// S5-FLOW-004 — "N open comments on vX" notes (behavioural)
// ---------------------------------------------------------------------------

describe('EarlierOpenNotes', () => {
  it('renders one note per earlier version with its count, pluralised', async () => {
    const React = (await import('react')).default
    ;(globalThis as { React?: unknown }).React = React
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { EarlierOpenNotes } = await import('./VersionSelector')
    const html = renderToStaticMarkup(
      React.createElement(EarlierOpenNotes, {
        notes: [
          { versionId: 'a', versionNumber: 1, openCount: 4 },
          { versionId: 'b', versionNumber: 2, openCount: 1 },
        ],
        onSelect: () => {},
      })
    )
    assert.equal((html.match(/data-testid="earlier-open-note"/g) ?? []).length, 2)
    assert.match(html, />4 open comments on v1</)
    assert.match(html, />1 open comment on v2</)
  })

  it('renders nothing when no earlier version has open comments', async () => {
    const React = (await import('react')).default
    ;(globalThis as { React?: unknown }).React = React
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { EarlierOpenNotes } = await import('./VersionSelector')
    const html = renderToStaticMarkup(
      React.createElement(EarlierOpenNotes, { notes: [], onSelect: () => {} })
    )
    assert.equal(html, '')
  })

  it('clicking a note selects that version', async () => {
    const React = (await import('react')).default
    ;(globalThis as { React?: unknown }).React = React
    const { EarlierOpenNotes } = await import('./VersionSelector')
    const picked: string[] = []
    const tree = EarlierOpenNotes({
      notes: [
        { versionId: 'ver-1', versionNumber: 1, openCount: 2 },
        { versionId: 'ver-2', versionNumber: 2, openCount: 3 },
      ],
      onSelect: (id: string) => picked.push(id),
    })
    // Find buttons by type and rendered text, not by position in the tree.
    type El = React.ReactElement<{ children?: unknown; onClick?: () => void }>
    const buttons: { text: string; click: () => void }[] = []
    const text = (n: unknown): string =>
      typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : ''
    const walk = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!React.isValidElement(n)) return
      const el = n as El
      if (el.type === 'button') {
        buttons.push({ text: text(el.props.children), click: el.props.onClick as () => void })
      } else walk(el.props.children)
    }
    walk(tree)
    buttons.find((b) => b.text === '3 open comments on v2')?.click()
    assert.deepEqual(picked, ['ver-2'])
  })

  it('wraps the notes in a labelled group', async () => {
    const React = (await import('react')).default
    ;(globalThis as { React?: unknown }).React = React
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { EarlierOpenNotes } = await import('./VersionSelector')
    const html = renderToStaticMarkup(
      React.createElement(EarlierOpenNotes, {
        notes: [{ versionId: 'a', versionNumber: 1, openCount: 1 }],
        onSelect: () => {},
      })
    )
    assert.match(html, /role="group" aria-label="Open comments on earlier versions"/)
  })
})

describe('VersionSelector — guest isolation', () => {
  it('is never imported by the guest page tree', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(d, e.name)
        return e.isDirectory() ? walk(p) : [p]
      })
    for (const f of walk(path.join(root, 'app', 'guest')).filter((f) => /\.tsx?$/.test(f))) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /VersionSelector/, f)
    }
  })
})
