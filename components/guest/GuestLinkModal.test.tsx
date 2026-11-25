import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { buildCreateBody as BuildCreateBody } from './GuestLinkModal'

// tsx uses the classic JSX runtime, which needs a global React (see GuestShareButton.test).
Object.assign(globalThis, { React })
let buildCreateBody: typeof BuildCreateBody
let html = ''
before(async () => {
  const mod = await import('./GuestLinkModal')
  buildCreateBody = mod.buildCreateBody
  html = renderToStaticMarkup(
    React.createElement(mod.GuestLinkModal, {
      videoId: 'v',
      isOpen: true,
      onClose: () => {},
      onCreated: () => {},
    })
  )
})

describe('GuestLinkModal', () => {
  it('shows the four presets in order', () => {
    const labels = ['24 hours', '3 days', '7 days', 'Never']
    let at = 0
    for (const l of labels) {
      const i = html.indexOf(`>${l}</label>`, at)
      assert.ok(i > -1, `missing preset ${l}`)
      at = i
    }
    assert.equal((html.match(/type="radio"/g) ?? []).length, 4)
  })

  it('preselects 3 days only', () => {
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? []
    const checked = radios.filter((r) => r.includes('checked'))
    assert.equal(checked.length, 1)
    assert.match(checked[0], /value="3d"/)
  })

  it('has an optional label input capped at 80 and no free date picker', () => {
    assert.match(html, /id="label"[^>]*maxLength="80"/)
    assert.doesNotMatch(html, /datetime-local/)
  })
})

describe('buildCreateBody', () => {
  const now = Date.UTC(2026, 0, 1)
  it('maps presets to expires_at and Never to null', () => {
    assert.equal(buildCreateBody('', '24h', now).expires_at, '2026-01-02T00:00:00.000Z')
    assert.equal(buildCreateBody('', '3d', now).expires_at, '2026-01-04T00:00:00.000Z')
    assert.equal(buildCreateBody('', '7d', now).expires_at, '2026-01-08T00:00:00.000Z')
    assert.equal(buildCreateBody('', 'never', now).expires_at, null)
  })
  it('trims the label and omits it when blank', () => {
    assert.equal(buildCreateBody('  Sam  ', '3d', now).label, 'Sam')
    assert.ok(!('label' in buildCreateBody('   ', '3d', now)))
  })
})
