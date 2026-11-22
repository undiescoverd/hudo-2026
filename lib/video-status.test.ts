import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { NO_OPEN_COMMENTS_MESSAGE, statusConfirmation, statusGuardError } from './video-status'

describe('statusGuardError', () => {
  it('refuses changes_requested with zero open comments', () => {
    assert.equal(statusGuardError('changes_requested', 0), NO_OPEN_COMMENTS_MESSAGE)
  })

  it('allows changes_requested with at least one open comment', () => {
    assert.equal(statusGuardError('changes_requested', 1), null)
    assert.equal(statusGuardError('changes_requested', 5), null)
  })

  it('never blocks other statuses, including approve with open comments', () => {
    assert.equal(statusGuardError('approved', 3), null)
    assert.equal(statusGuardError('approved', 0), null)
    assert.equal(statusGuardError('in_review', 0), null)
    assert.equal(statusGuardError('pending_review', 0), null)
  })
})

describe('statusConfirmation', () => {
  it('warns with the count when approving with open comments (plural)', () => {
    const c = statusConfirmation('in_review', 'approved', 3)
    assert.equal(c?.kind, 'approve_with_open')
    assert.equal(c?.message, '3 comments are still open. Approve anyway?')
  })

  it('uses singular for one open comment', () => {
    assert.equal(
      statusConfirmation('in_review', 'approved', 1)?.message,
      '1 comment is still open. Approve anyway?'
    )
  })

  it('does not prompt when approving with no open comments', () => {
    assert.equal(statusConfirmation('in_review', 'approved', 0), null)
  })

  it('confirms when leaving approved', () => {
    for (const to of ['draft', 'pending_review', 'in_review', 'changes_requested'] as const) {
      assert.equal(statusConfirmation('approved', to, 2)?.kind, 'leave_approved')
    }
  })

  it('does not prompt for other moves or a no-op', () => {
    assert.equal(statusConfirmation('pending_review', 'in_review', 4), null)
    assert.equal(statusConfirmation('in_review', 'changes_requested', 2), null)
    assert.equal(statusConfirmation('approved', 'approved', 2), null)
  })
})
