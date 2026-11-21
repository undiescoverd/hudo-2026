import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { deriveChecklist } from '@/lib/onboarding-checklist'

const render = (members: Array<{ role: string }>, hasVideoVersion = false) =>
  renderToStaticMarkup(
    createElement(OnboardingChecklist, {
      items: deriveChecklist({ members, invitations: [], hasVideoVersion }).items,
    })
  )

describe('OnboardingChecklist', () => {
  it('links each pending item to its action', () => {
    const html = render([])
    assert.match(html, /href="\/settings\/team"[^>]*>Invite an agent/)
    assert.match(html, /href="\/settings\/team"[^>]*>Invite a talent/)
    assert.match(html, /href="\/upload"[^>]*>Upload a video/)
    assert.match(html, /0 of 3 done/)
  })

  it('renders completed items without a link', () => {
    const html = render([{ role: 'agent' }])
    assert.doesNotMatch(html, />Invite an agent<\/a>/)
    assert.match(html, /Invite an agent/)
    assert.match(html, /1 of 3 done/)
  })
})
