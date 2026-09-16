import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatChunk, ChatRequest, LlmPort } from '@experttranslate/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type CliDeps, main } from '../src/cli.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eta-cli-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

interface Harness {
  deps: CliDeps
  out: string[]
  err: string[]
  requests: ChatRequest[]
  controller: AbortController
}

const harness = (reply: (req: ChatRequest) => string, stdin = ''): Harness => {
  const out: string[] = []
  const err: string[] = []
  const requests: ChatRequest[] = []
  const controller = new AbortController()
  let ids = 0
  const llm: LlmPort = {
    async *chat(req): AsyncIterable<ChatChunk> {
      requests.push(req)
      await Promise.resolve()
      yield { type: 'delta', text: reply(req) }
      yield { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001 } }
    },
    models: () =>
      Promise.resolve([
        {
          id: 'x/one',
          name: 'One',
          contextLength: 1,
          pricing: { promptUsdPerToken: 1e-6, completionUsdPerToken: 2e-6 },
          supportsStructuredOutput: false,
        },
      ]),
    keyInfo: () => Promise.resolve({ label: 'k', limitUsd: 5, usageUsd: 1.5, isFreeTier: false }),
  }
  return {
    out,
    err,
    requests,
    controller,
    deps: {
      env: { OPENROUTER_API_KEY: 'sk-test', ETA_DATA_DIR: dir, ETA_LOG_LEVEL: 'silent' },
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      readStdin: () => Promise.resolve(stdin),
      stdinIsTty: stdin === '',
      createLlm: () => llm,
      now: () => 1,
      makeId: () => `id-${++ids}`,
      signal: controller.signal,
      fatal: (e) => err.push(String(e)),
    },
  }
}

const simple = ['--difficulty', 'simple', '--no-escalate']

describe('eta translate', () => {
  it('translates a file into two targets, writes files and JSON, and stores the run', async () => {
    const h = harness((req) => {
      const system = req.messages[0]?.content ?? ''
      const user = req.messages[1]?.content ?? ''
      const tokens = user.match(/⟦PH\d+⟧/g) ?? []
      return `${system.includes('to fr') ? 'Bonjour' : 'Olá'} ${tokens.join(' ')}`
    })
    const input = join(dir, 'in.md')
    await writeFile(input, 'Hello {{name}}, see https://example.com')
    const outDir = join(dir, 'out')
    const argv = [
      'translate',
      input,
      '--to',
      'fr,pt-BR:Brazil',
      ...simple,
      '--out',
      outDir,
      '--json',
      '--model',
      't/m',
    ]
    expect(await main(argv, h.deps)).toBe(0)
    expect(await readFile(join(outDir, 'fr.txt'), 'utf8')).toBe(
      'Bonjour {{name}} https://example.com\n',
    )
    expect(await readFile(join(outDir, 'pt-BR-brazil.txt'), 'utf8')).toBe(
      'Olá {{name}} https://example.com\n',
    )
    expect(JSON.parse(h.out.join(''))).toHaveLength(2)
    expect(h.requests).toHaveLength(2)
    expect(h.err.some((l) => l.startsWith('■ total: 2 calls'))).toBe(true)
    const jobs = JSON.parse(await readFile(join(dir, 'jobs.json'), 'utf8')) as Array<{
      status: string
    }>
    expect(jobs[0]?.status).toBe('done')
    expect(JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'))).toHaveLength(2)
  })

  it('reads stdin, loads a context file and extracts guideline rules once', async () => {
    const h = harness(
      (req) =>
        (req.messages[1]?.content ?? '').includes('Always use the formal vous form')
          ? JSON.stringify([{ text: 'Never use tu', kind: 'must-not', pattern: '\\btu\\b' }])
          : 'Salut',
      'Hello',
    )
    const ctx = join(dir, 'ctx.md')
    await writeFile(ctx, '# Product\nThe product is called Zephyr.')
    const gl = join(dir, 'style.md')
    await writeFile(gl, 'Always use the formal vous form.')
    const argv = [
      'translate',
      '--to',
      'fr',
      ...simple,
      '--json',
      '--context',
      ctx,
      '--guidelines',
      gl,
    ]
    expect(await main(argv, h.deps)).toBe(0)
    const system = h.requests.at(-1)?.messages[0]?.content ?? ''
    expect(system).toContain('Zephyr')
    expect(system).toContain('MUST NOT use tu')
    const results = JSON.parse(h.out.join('')) as Array<{ targetKey: string; finalText: string }>
    expect(results).toEqual([expect.objectContaining({ targetKey: 'fr', finalText: 'Salut' })])
    const calls = h.requests.length
    h.out.length = 0
    expect(await main(argv, h.deps)).toBe(0)
    expect(h.requests.length).toBe(calls + 1)
    expect(JSON.parse(await readFile(join(dir, 'guidelines.json'), 'utf8'))).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, 'contexts.json'), 'utf8'))).toHaveLength(1)
  })

  it('reports a cancelled run when the signal fires', async () => {
    const h = harness(() => 'x', 'Hello')
    h.controller.abort(new Error('received SIGINT'))
    expect(await main(['translate', '--to', 'fr', ...simple], h.deps)).toBe(1)
    expect(h.err.at(-1)).toBe('cancelled')
    const jobs = JSON.parse(await readFile(join(dir, 'jobs.json'), 'utf8')) as Array<{
      status: string
    }>
    expect(jobs[0]?.status).toBe('cancelled')
  })

  it('fails with usage on bad flags and without a key', async () => {
    const h = harness(() => 'x')
    expect(await main(['translate', '--to', 'fr', '--reasoning', 'max'], h.deps)).toBe(2)
    expect(h.err[0]).toContain('--reasoning must be one of')
    const noKey = harness(() => 'x', 'Hello')
    noKey.deps.env = { ETA_DATA_DIR: dir, ETA_LOG_LEVEL: 'silent' }
    expect(await main(['translate', '--to', 'fr'], noKey.deps)).toBe(1)
    expect(noKey.err.at(-1)).toContain('OPENROUTER_API_KEY')
  })
})

describe('eta models, key and import', () => {
  it('lists models with prices and shows key usage', async () => {
    const h = harness(() => 'x')
    expect(await main(['models', '--filter', 'one'], h.deps)).toBe(0)
    expect(h.out[0]).toBe('x/one\tOne\t$1.00/M in, $2.00/M out\n')
    expect(await main(['key'], h.deps)).toBe(0)
    expect(h.out[1]).toBe('k: used $1.5000 of $5.00\n')
  })

  it('imports a web export with its historical table names', async () => {
    const h = harness(() => 'x')
    const file = join(dir, 'export.json')
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        exportedAt: 0,
        tables: {
          guidelineSets: [{ id: 'g1', name: 'Style', rules: [], enabled: true, createdAt: 0 }],
          contextSources: [
            {
              id: 'c1',
              name: 'x',
              kind: 'pasted',
              rawText: 'x',
              contentHash: 'h',
              enabled: true,
              createdAt: 0,
            },
          ],
          bogus: [{ id: 'nope' }],
        },
      }),
    )
    expect(await main(['import', file], h.deps)).toBe(0)
    expect(JSON.parse(await readFile(join(dir, 'guidelines.json'), 'utf8'))).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, 'contexts.json'), 'utf8'))).toHaveLength(1)
    expect(h.err.at(-1)).toContain('imported 2 rows')
    expect(await main(['import', join(dir, 'nope.json')], h.deps)).toBe(1)
  })
})
