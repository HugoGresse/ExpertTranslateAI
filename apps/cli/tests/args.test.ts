import { describe, expect, it } from 'vitest'
import { parseCliArgs, parseTargets } from '../src/args.ts'

describe('parseTargets', () => {
  it('accepts region suffixes in both spellings', () => {
    expect(parseTargets('fr, es-MX,pt:Brazil')).toEqual([
      { lang: 'fr' },
      { lang: 'es', region: 'MX' },
      { lang: 'pt', region: 'Brazil' },
    ])
  })
  it('rejects an empty list', () => {
    expect(() => parseTargets(' , ')).toThrow('--to needs at least one language')
  })
})

describe('parseCliArgs', () => {
  it('parses a translate command with role overrides and materials', () => {
    const args = parseCliArgs([
      'translate',
      'doc.md',
      '--to',
      'fr,de',
      '--model',
      'a/b',
      '--reviewer',
      'c/d',
      '--difficulty',
      'hard',
      '--context',
      'https://x.test/llms.txt',
      '--context',
      './notes.md',
      '--memory',
      '--no-escalate',
      '--budget',
      '0.5',
      '--out',
      'out',
      '--data-dir',
      '/tmp/eta',
    ])
    expect(args.command).toBe('translate')
    if (args.command !== 'translate') return
    expect(args.input).toBe('doc.md')
    expect(args.targets).toEqual([{ lang: 'fr' }, { lang: 'de' }])
    expect(args.model).toBe('a/b')
    expect(args.models.reviewer).toBe('c/d')
    expect(args.difficulty).toBe('hard')
    expect(args.contexts).toEqual(['https://x.test/llms.txt', './notes.md'])
    expect(args.useMemory).toBe(true)
    expect(args.autoEscalate).toBe(false)
    expect(args.budgetUsd).toBe(0.5)
    expect(args.outDir).toBe('out')
    expect(args.dataDir).toBe('/tmp/eta')
  })
  it('rejects bad enum values and a missing --to', () => {
    expect(() => parseCliArgs(['translate', '--to', 'fr', '--difficulty', 'extreme'])).toThrow(
      '--difficulty must be one of',
    )
    expect(() => parseCliArgs(['translate'])).toThrow('--to is required')
    expect(() => parseCliArgs(['frobnicate'])).toThrow('Unknown command')
  })
  it('returns help with no command', () => {
    expect(parseCliArgs([]).command).toBe('help')
    expect(parseCliArgs(['--help']).command).toBe('help')
  })
})
