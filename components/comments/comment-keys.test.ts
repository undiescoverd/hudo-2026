/**
 * Keys in the comment textareas (inline edit box and reply composer).
 *
 * Run: npx tsx --test components/comments/comment-keys.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { editKeyAction } from './comment-keys'

describe('editKeyAction', () => {
  it('Enter saves', () => {
    assert.equal(editKeyAction('Enter', false), 'save')
  })

  it('Shift+Enter is a newline: no action', () => {
    assert.equal(editKeyAction('Enter', true), null)
  })

  it('Escape cancels, with or without Shift', () => {
    assert.equal(editKeyAction('Escape', false), 'cancel')
    assert.equal(editKeyAction('Escape', true), 'cancel')
  })

  it('every other key does nothing', () => {
    for (const key of ['a', ' ', 'Tab', 'ArrowUp', 'Backspace']) {
      assert.equal(editKeyAction(key, false), null, key)
    }
  })
})
