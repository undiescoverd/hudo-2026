import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BulkResultMessage, applyBulkStatus, formatRowError } from './BulkStatusUpdate'

describe('BulkStatusUpdate formatRowError', () => {
  it('names the refused row by title', () => {
    assert.equal(
      formatRowError('Spring Reel', new Error('Add at least one open comment first.')),
      'Spring Reel: Add at least one open comment first.'
    )
  })

  it('falls back to the bare message without a title', () => {
    assert.equal(formatRowError(undefined, new Error('HTTP 500')), 'HTTP 500')
    assert.equal(formatRowError(undefined, 'boom'), 'boom')
  })
})

describe('BulkStatusUpdate per-row refusal', () => {
  const refusal = 'Add at least one open comment on the current version before requesting changes.'
  // v2 is refused with the server's 409 message, the others succeed.
  const patch = async (id: string) => {
    if (id === 'v2') throw new Error(refusal)
  }

  it('applyBulkStatus collects the 409 row by title and still counts the successes', async () => {
    const result = await applyBulkStatus(
      ['v1', 'v2', 'v3'],
      'changes_requested',
      { v1: 'Reel A', v2: 'Reel B', v3: 'Reel C' },
      patch
    )
    assert.equal(result.succeeded, 2)
    assert.equal(result.failed, 1)
    assert.deepEqual(result.errors, [`Reel B: ${refusal}`])
  })

  it('the rendered error list shows the refused row', async () => {
    const result = await applyBulkStatus(['v1', 'v2'], 'changes_requested', { v2: 'Reel B' }, patch)
    const html = renderToStaticMarkup(createElement(BulkResultMessage, { result }))
    assert.match(html, /1 updated\./)
    assert.match(html, /1 failed: Reel B: Add at least one open comment/)
  })
})
