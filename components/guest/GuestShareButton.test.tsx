/**
 * GuestShareButton — render tests for the role gate.
 *
 * The guest-links API is agent+ only (requireAgentRole), so the button must
 * render nothing for talent (and while the role is still unknown) and the
 * Share control for owner / admin_agent / agent. Rendered with
 * react-dom/server — no DOM runtime needed.
 *
 * Run: npx tsx --test components/guest/GuestShareButton.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GuestShareButton as GuestShareButtonComponent } from './GuestShareButton'

// tsx compiles the component's JSX with the classic runtime (tsconfig has
// jsx: preserve for Next), which expects a global React — provide it, then
// import the component.
Object.assign(globalThis, { React })
let GuestShareButton: typeof GuestShareButtonComponent
before(async () => {
  ;({ GuestShareButton } = await import('./GuestShareButton'))
})

const VIDEO_ID = '22222222-2222-4222-8222-222222222222'

function render(role: string | null): string {
  return renderToStaticMarkup(React.createElement(GuestShareButton, { videoId: VIDEO_ID, role }))
}

describe('GuestShareButton — role gate', () => {
  it('renders nothing for talent', () => {
    assert.equal(render('talent'), '')
  })

  it('renders nothing while the role is unknown (no flash before it loads)', () => {
    assert.equal(render(null), '')
  })

  it('renders nothing for guest or unrecognised roles', () => {
    assert.equal(render('guest'), '')
    assert.equal(render('superuser'), '')
  })

  for (const role of ['owner', 'admin_agent', 'agent']) {
    it(`renders the Share button for ${role}`, () => {
      assert.match(render(role), /<button[^>]*>Share<\/button>/)
    })
  }
})
