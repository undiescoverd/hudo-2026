/**
 * Source-regex checks for the v3 video page design (S4-DESIGN-002).
 * Run: pnpm exec tsx --test components/player/video-page-design.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('video page v3 design', () => {
  it('video stage uses the dark stage token', () => {
    assert.match(read('components/player/VideoPlayer.tsx'), /bg-stage/)
  })

  it('timeline markers are coral, resolved ones fade to faint', () => {
    const src = read('components/player/TimelineBadge.tsx')
    assert.match(src, /bg-coral/)
    assert.match(src, /bg-faint/)
    assert.doesNotMatch(src, /hsl\(/)
  })

  it('comment timecodes are mono coral chips', () => {
    const src = read('components/comments/CommentItem.tsx')
    assert.match(src, /bg-coral-soft[^'"`]*text-coral-text/)
    assert.match(src, /font-mono/)
  })

  it('layout has a fixed 384px comment rail', () => {
    assert.match(read('components/player/MobilePlayerLayout.tsx'), /384px/)
  })

  it('upload new version is a ghost button, coral only when the talent must resubmit', () => {
    const src = read('app/(dashboard)/videos/[id]/page.tsx')
    assert.match(
      src,
      /buttonVariants\(\{ variant: needsResubmit \? 'primary' : 'ghost' \}\)[\s\S]*Upload new version/
    )
  })
})
