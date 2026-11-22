import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { VideoStatusControl, type StatusInfo } from './VideoStatusControl'

const render = (status: string, initialInfo: StatusInfo | null) =>
  renderToStaticMarkup(
    createElement(VideoStatusControl, { videoId: 'v1', status, onChanged: () => {}, initialInfo })
  )

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

describe('VideoStatusControl markup', () => {
  it('shows "Changed by {name}, {relative time}"', () => {
    const html = render('in_review', {
      changedBy: 'Alex Agent',
      changedAt: ago(2 * 3_600_000),
      openComments: 1,
    })
    assert.match(html, /Changed by Alex Agent, 2h ago/)
  })

  it('shows "a team member" instead of an email-shaped name', () => {
    const html = render('in_review', {
      changedBy: 'someone@agency.test',
      changedAt: ago(60_000 * 10),
      openComments: 0,
    })
    assert.match(html, /Changed by a team member, 10m ago/)
    assert.doesNotMatch(html, /someone@agency\.test/)
  })

  it('shows nothing about a change before info loads, and no confirm prompt by default', () => {
    const html = render('approved', null)
    assert.doesNotMatch(html, /Changed by/)
    assert.doesNotMatch(html, /alertdialog/)
  })

  it('lists every status except the current one', () => {
    const html = render('approved', null)
    assert.match(html, /aria-label="Change status"/)
    assert.match(html, /Changes requested/)
    assert.doesNotMatch(html, /<option value="approved"/)
  })
})
