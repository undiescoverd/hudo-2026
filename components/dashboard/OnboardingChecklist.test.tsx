import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { deriveChecklist } from '@/lib/onboarding-checklist'

const render = (members: Array<{ role: string }>) =>
  renderToStaticMarkup(
    createElement(OnboardingChecklist, {
      items: deriveChecklist({ members, invitations: [] }).items,
    })
  )

describe('OnboardingChecklist', () => {
  it('links each pending item to its action', () => {
    const html = render([])
    assert.match(html, /href="\/settings\/team"[^>]*>Invite an agent/)
    assert.match(html, /href="\/settings\/team"[^>]*>Invite a talent/)
    assert.doesNotMatch(html, /Upload a video/)
    assert.doesNotMatch(html, /href="\/upload"/)
    assert.match(html, /0 of 2 done/)
  })

  it('renders completed items without a link', () => {
    const html = render([{ role: 'agent' }])
    assert.doesNotMatch(html, />Invite an agent<\/a>/)
    assert.match(html, /Invite an agent/)
    assert.match(html, /1 of 2 done/)
  })
})
