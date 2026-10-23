/**
 * Player keyboard shortcuts: Space must not hijack interactive elements (the
 * comment action buttons live next to the player), and typing in a field never
 * triggers a shortcut.
 *
 * Run: npx tsx --test hooks/usePlayerShortcuts.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSpaceInteractive, playerShortcutFor } from './usePlayerShortcuts'

/** A minimal stand-in for a DOM element. */
function el(tagName: string, attrs: Record<string, string> = {}): EventTarget {
  return {
    tagName,
    getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
  } as unknown as EventTarget
}

describe('isSpaceInteractive', () => {
  it('is true for buttons, selects and <summary>', () => {
    for (const tag of ['BUTTON', 'SELECT', 'SUMMARY', 'button']) {
      assert.equal(isSpaceInteractive(el(tag)), true, tag)
    }
  })

  it('is true for links with an href, false for anchors without one', () => {
    assert.equal(isSpaceInteractive(el('A', { href: '/videos' })), true)
    assert.equal(isSpaceInteractive(el('A')), false)
  })

  it('is true for role="button" and contenteditable="true" elements', () => {
    assert.equal(isSpaceInteractive(el('DIV', { role: 'button' })), true)
    assert.equal(isSpaceInteractive(el('DIV', { contenteditable: 'true' })), true)
  })

  it('is false for plain content, other roles, contenteditable="false", body and null', () => {
    assert.equal(isSpaceInteractive(el('DIV')), false)
    assert.equal(isSpaceInteractive(el('VIDEO')), false)
    assert.equal(isSpaceInteractive(el('BODY')), false)
    assert.equal(isSpaceInteractive(el('DIV', { role: 'tab' })), false)
    assert.equal(isSpaceInteractive(el('DIV', { contenteditable: 'false' })), false)
    assert.equal(isSpaceInteractive(null), false)
  })
})

describe('playerShortcutFor', () => {
  it('Space toggles playback from the page body or the player', () => {
    assert.equal(
      playerShortcutFor({ key: ' ', target: el('BODY'), activeTag: 'BODY' }),
      'playPause'
    )
    assert.equal(
      playerShortcutFor({ key: ' ', target: el('VIDEO'), activeTag: 'VIDEO' }),
      'playPause'
    )
    assert.equal(playerShortcutFor({ key: ' ', target: null }), 'playPause')
  })

  it('Space on a focused comment action button is left alone (the button activates)', () => {
    for (const target of [
      el('BUTTON'),
      el('A', { href: '#' }),
      el('SELECT'),
      el('SUMMARY'),
      el('DIV', { role: 'button' }),
      el('DIV', { contenteditable: 'true' }),
    ]) {
      assert.equal(playerShortcutFor({ key: ' ', target, activeTag: 'BUTTON' }), null)
    }
  })

  it('no shortcut fires while typing in an input or textarea', () => {
    for (const activeTag of ['INPUT', 'TEXTAREA', 'textarea']) {
      for (const key of [' ', 'c', 'i', 'o', 'x']) {
        assert.equal(
          playerShortcutFor({ key, target: el(activeTag), activeTag }),
          null,
          `${activeTag} ${key}`
        )
      }
    }
  })

  it('the letter shortcuts are unchanged and still work with a button focused', () => {
    const base = { target: el('BUTTON'), activeTag: 'BUTTON' }
    assert.equal(playerShortcutFor({ ...base, key: 'c' }), 'commentAtTime')
    assert.equal(playerShortcutFor({ ...base, key: 'I' }), 'rangeIn')
    assert.equal(playerShortcutFor({ ...base, key: 'o' }), 'rangeOut')
    assert.equal(playerShortcutFor({ ...base, key: 'X' }), 'clearRange')
  })

  it('other keys do nothing', () => {
    assert.equal(playerShortcutFor({ key: 'Enter', target: el('BODY') }), null)
    assert.equal(playerShortcutFor({ key: 'a', target: el('BODY') }), null)
  })
})
