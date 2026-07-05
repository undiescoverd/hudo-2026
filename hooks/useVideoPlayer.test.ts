/**
 * Unit tests for useVideoPlayer pure helper functions.
 *
 * Tests clampSeek and clampVolume — no DOM or React required.
 *
 * Run: npx tsx --test hooks/useVideoPlayer.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Test: clampSeek
// ---------------------------------------------------------------------------

describe('clampSeek', () => {
  it('clamps negative values to 0', async () => {
    const { clampSeek } = await import('./useVideoPlayer')
    assert.equal(clampSeek(-5, 120), 0)
  })

  it('clamps values beyond duration to duration', async () => {
    const { clampSeek } = await import('./useVideoPlayer')
    assert.equal(clampSeek(200, 120), 120)
  })

  it('passes through values within [0, duration]', async () => {
    const { clampSeek } = await import('./useVideoPlayer')
    assert.equal(clampSeek(60, 120), 60)
    assert.equal(clampSeek(0, 120), 0)
    assert.equal(clampSeek(120, 120), 120)
  })

  it('clamps to 0 when duration is 0', async () => {
    const { clampSeek } = await import('./useVideoPlayer')
    assert.equal(clampSeek(10, 0), 0)
  })
})

// ---------------------------------------------------------------------------
// Test: clampVolume
// ---------------------------------------------------------------------------

describe('clampVolume', () => {
  it('clamps negative values to 0', async () => {
    const { clampVolume } = await import('./useVideoPlayer')
    assert.equal(clampVolume(-0.5), 0)
  })

  it('clamps values above 1 to 1', async () => {
    const { clampVolume } = await import('./useVideoPlayer')
    assert.equal(clampVolume(1.5), 1)
  })

  it('passes through values within [0, 1]', async () => {
    const { clampVolume } = await import('./useVideoPlayer')
    assert.equal(clampVolume(0), 0)
    assert.equal(clampVolume(0.5), 0.5)
    assert.equal(clampVolume(1), 1)
  })
})

// ---------------------------------------------------------------------------
// Test: State transition logic (pure mirrors of hook behaviour)
// ---------------------------------------------------------------------------
// (formatTime used to live on this hook; it moved to lib/format-time.ts as
// formatTimecode — see lib/format-time.test.ts for its coverage — because
// PlayerControls, CommentItem, CommentInput, and GuestComments all need the
// same timecode formatting and previously carried four slightly different
// copies.)

describe('player state transitions', () => {
  it('play sets playing to true', () => {
    let playing = false
    const onPlay = () => {
      playing = true
    }
    onPlay()
    assert.equal(playing, true)
  })

  it('pause sets playing to false', () => {
    let playing = true
    const onPause = () => {
      playing = false
    }
    onPause()
    assert.equal(playing, false)
  })

  it('seek applies clamped time to video element', async () => {
    const { clampSeek } = await import('./useVideoPlayer')
    const duration = 120
    const el = { currentTime: 0, duration }
    const seek = (t: number) => {
      el.currentTime = clampSeek(t, el.duration)
    }

    seek(50)
    assert.equal(el.currentTime, 50)

    seek(200)
    assert.equal(el.currentTime, 120)

    seek(-5)
    assert.equal(el.currentTime, 0)
  })

  it('setVolume applies clamped volume to video element', async () => {
    const { clampVolume } = await import('./useVideoPlayer')
    const el = { volume: 1 }
    const setVolume = (v: number) => {
      el.volume = clampVolume(v)
    }

    setVolume(0.5)
    assert.equal(el.volume, 0.5)

    setVolume(2)
    assert.equal(el.volume, 1)

    setVolume(-1)
    assert.equal(el.volume, 0)
  })
})
