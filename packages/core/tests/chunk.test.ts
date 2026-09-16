import { describe, expect, it } from 'vitest'
import { calculateChunkSize, chunkText } from '../src/text/chunk.ts'
import { countTokens } from '../src/text/tokens.ts'

describe('calculateChunkSize', () => {
  it('returns the token count when under the limit', () => {
    expect(calculateChunkSize(500, 1000)).toBe(500)
  })
  it('balances chunks like translation-agent', () => {
    expect(calculateChunkSize(1530, 500)).toBe(389)
    expect(calculateChunkSize(2100, 500)).toBe(440)
  })
})

describe('chunkText', () => {
  const paragraph = 'The quick brown fox jumps over the lazy dog. '.repeat(20)
  const text = Array.from({ length: 6 }, () => paragraph.trim()).join('\n\n')

  it('keeps short text in one chunk', () => {
    const chunks = chunkText('short text', 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.index).toBe(0)
  })

  it('splits long text on paragraph boundaries and preserves every character', () => {
    const chunks = chunkText(text, 300)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((c) => c.text).join('')).toBe(text)
    for (const chunk of chunks) expect(chunk.tokenEstimate).toBeLessThanOrEqual(310)
  })

  it('reports token estimates consistent with countTokens', () => {
    const chunks = chunkText(text, 300)
    for (const chunk of chunks) expect(chunk.tokenEstimate).toBe(countTokens(chunk.text))
  })
})
