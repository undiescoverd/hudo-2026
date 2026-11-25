/**
 * Authed player load-failure state (S5-ERR-001): calm copy instead of the raw media
 * error, Retry, and a switch to the page's existing version list.
 *
 * Run: pnpm exec tsx components/player/VideoPlayer.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import React from 'react'
import { expand, findAll, textOf } from './tree.testutil'

import type * as VideoPlayerMod from './VideoPlayer'
type Mod = typeof VideoPlayerMod
const versions = [
  { id: 'v2', versionNumber: 2 },
  { id: 'v1', versionNumber: 1 },
]

describe('VideoLoadFailed', () => {
  let m: Mod
  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    m = await import('./VideoPlayer')
  })
  const render = (props: Partial<React.ComponentProps<Mod['VideoLoadFailed']>> = {}) =>
    expand(React.createElement(m.VideoLoadFailed, { onRetry() {}, ...props }))

  it('shows the calm message, not a raw media error', () => {
    const text = textOf(render())
    assert.match(text, /This version couldn't be loaded/)
    assert.doesNotMatch(text, /MEDIA_ERR|NotSupported|format|NoSuchKey|Failed to load video/i)
    assert.doesNotMatch(text, /\bnotes?\b/i)
  })

  it('Retry calls onRetry', () => {
    let retries = 0
    const [btn] = findAll(render({ onRetry: () => retries++ }), (e) => e.type === 'button')
    assert.equal(textOf(btn), 'Retry')
    ;(btn.props.onClick as () => void)()
    assert.equal(retries, 1)
  })

  it('offers the other versions and switching calls the page setter', () => {
    const picked: string[] = []
    const tree = render({
      currentVersionId: 'v2',
      versions,
      onVersionChange: (id) => picked.push(id),
    })
    const buttons = findAll(tree, (e) => e.type === 'button')
    assert.deepEqual(buttons.map(textOf), ['Retry', 'v1']) // current version is not offered
    ;(buttons[1].props.onClick as () => void)()
    assert.deepEqual(picked, ['v1'])
  })

  it('offers no switch when there is no other version or no setter', () => {
    const only = render({ currentVersionId: 'v1', versions: [versions[1]], onVersionChange() {} })
    assert.deepEqual(findAll(only, (e) => e.type === 'button').map(textOf), ['Retry'])
    const noSetter = render({ currentVersionId: 'v2', versions })
    assert.deepEqual(findAll(noSetter, (e) => e.type === 'button').map(textOf), ['Retry'])
  })
})
