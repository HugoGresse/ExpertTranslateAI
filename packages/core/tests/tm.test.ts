import { describe, expect, it } from 'vitest'
import { normalizeSentence, splitSentences } from '../src/text/sentences.ts'
import { learnCorrections } from '../src/tm/learn.ts'
import { formatMemoryBlock, matchMemory, trigramSimilarity } from '../src/tm/match.ts'
import type { TmEntry } from '../src/types.ts'

const tm = (id: string, source: string, target: string, targetLang = 'fr'): TmEntry => ({
  id,
  sourceLang: 'en',
  targetLang,
  source,
  target,
  origin: 'human-correction',
  createdAt: 0,
})

describe('sentences', () => {
  it('splits on sentence boundaries and newlines', () => {
    expect(splitSentences('Hello there. How are you?\n- item one\nDone!')).toEqual([
      'Hello there.',
      'How are you?',
      '- item one',
      'Done!',
    ])
  })
  it('normalizes case, punctuation and whitespace', () => {
    expect(normalizeSentence('  Hello,   World! ')).toBe('hello world')
  })
})

describe('matchMemory', () => {
  const entries = [
    tm('a', 'Click Save to continue.', 'Cliquez sur Enregistrer pour continuer.'),
    tm('b', 'Your changes were saved successfully.', 'Vos modifications ont été enregistrées.'),
    tm('c', 'Click Save to continue.', 'Klicken Sie auf Speichern.', 'de'),
  ]

  it('finds exact matches ignoring case and punctuation', () => {
    const m = matchMemory('click save to continue', entries, 'en', 'fr')
    expect(m.exact).toHaveLength(1)
    expect(m.exact[0]?.entryId).toBe('a')
    expect(m.fuzzy).toEqual([])
  })

  it('finds fuzzy matches above the threshold and filters by language pair', () => {
    const m = matchMemory('Your changes were saved successfully!', entries, 'en', 'fr')
    expect(m.exact).toHaveLength(1)
    const f = matchMemory('Your changes were saved succesfully.', entries, 'en', 'fr')
    expect(f.exact).toEqual([])
    expect(f.fuzzy[0]?.entryId).toBe('b')
    expect(matchMemory('Click Save to continue.', entries, 'en', 'es')).toEqual({
      exact: [],
      fuzzy: [],
    })
  })

  it('formats a memory block', () => {
    const block = formatMemoryBlock(matchMemory('Click Save to continue.', entries, 'en', 'fr'))
    expect(block).toContain('<MEMORY>')
    expect(block).toContain('EXACT (reuse verbatim)')
    expect(formatMemoryBlock({ exact: [], fuzzy: [] })).toBe('')
    expect(trigramSimilarity('abc', 'abc')).toBe(1)
  })
})

describe('learnCorrections', () => {
  const base = { sourceLang: 'en', targetLang: 'fr', makeId: () => 'id', now: 1 }

  it('stores only the sentences the user changed when counts align', () => {
    const out = learnCorrections({
      ...base,
      sourceText: 'Click Save. Then close the window.',
      originalText: 'Cliquez sur Sauver. Puis fermez la fenêtre.',
      editedText: 'Cliquez sur Enregistrer. Puis fermez la fenêtre.',
    })
    expect(out).toEqual([
      {
        id: 'id',
        sourceLang: 'en',
        targetLang: 'fr',
        source: 'Click Save.',
        target: 'Cliquez sur Enregistrer.',
        origin: 'human-correction',
        createdAt: 1,
      },
    ])
  })

  it('falls back to a whole-text pair when sentence counts differ', () => {
    const out = learnCorrections({
      ...base,
      sourceText: 'One. Two.',
      originalText: 'Un. Deux.',
      editedText: 'Un et deux.',
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.source).toBe('One. Two.')
  })

  it('returns nothing when unchanged', () => {
    expect(
      learnCorrections({ ...base, sourceText: 'One.', originalText: 'Un.', editedText: 'Un. ' }),
    ).toEqual([])
  })
})
