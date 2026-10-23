import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseTargetVideoId } from './new-version-upload'

describe('parseTargetVideoId', () => {
  it('returns a string id', () => assert.equal(parseTargetVideoId('abc'), 'abc'))
  it('trims whitespace', () => assert.equal(parseTargetVideoId(' abc '), 'abc'))
  it('ignores undefined, blank and array values', () => {
    assert.equal(parseTargetVideoId(undefined), undefined)
    assert.equal(parseTargetVideoId('  '), undefined)
    assert.equal(parseTargetVideoId(['a', 'b']), undefined)
  })
})
