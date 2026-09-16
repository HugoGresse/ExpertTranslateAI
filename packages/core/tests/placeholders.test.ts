import { describe, expect, it } from 'vitest'
import {
  placeholderParity,
  protectPlaceholders,
  restorePlaceholders,
} from '../src/text/placeholders.ts'

describe('placeholders', () => {
  const source =
    'Run `npm i` then open https://example.com/{{slug}} with <b>{count}</b> items, %s done.'

  it('replaces protected spans with tokens and restores them', () => {
    const protectedText = protectPlaceholders(source)
    expect(protectedText.text).not.toContain('https://')
    expect(protectedText.text).not.toContain('{{slug}}')
    expect(protectedText.text).toMatch(/⟦PH\d+⟧/)
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(source)
  })

  it('protects fenced code blocks as a whole', () => {
    const text = 'Before\n```js\nconst a = {b}\n```\nAfter'
    const protectedText = protectPlaceholders(text)
    expect(protectedText.placeholders.size).toBe(1)
    expect(restorePlaceholders(protectedText.text, protectedText.placeholders)).toBe(text)
  })

  it('detects missing and extra tokens', () => {
    const parity = placeholderParity('a ⟦PH0⟧ b ⟦PH1⟧', 'x ⟦PH1⟧ y ⟦PH9⟧')
    expect(parity.missing).toEqual(['⟦PH0⟧'])
    expect(parity.extra).toEqual(['⟦PH9⟧'])
  })
})
