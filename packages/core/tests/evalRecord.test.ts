import { describe, expect, it } from 'vitest'
import { promptOverrideHash, wordCount } from '../src/pipeline/evalRecord.ts'

describe('evalRecord helpers', () => {
  it('hashes overrides deterministically and ignores empty ones', () => {
    expect(promptOverrideHash({})).toBe('default')
    expect(promptOverrideHash({ translate: '  ' })).toBe('default')
    const a = promptOverrideHash({ translate: 'x', review: 'y' })
    expect(promptOverrideHash({ review: 'y', translate: 'x' })).toBe(a)
    expect(promptOverrideHash({ translate: 'z' })).not.toBe(a)
  })
  it('counts words', () => {
    expect(wordCount('  one two\nthree ')).toBe(3)
  })
})
