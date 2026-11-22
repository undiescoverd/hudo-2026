import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRowError } from './BulkStatusUpdate'

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
