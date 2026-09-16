import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createBudgetTracker } from '../src/pipeline/budget.ts'
import { callRoleJson, type StageContext } from '../src/pipeline/call.ts'
import { noopLogger } from '../src/ports.ts'
import { createFakeLlm } from './fakes.ts'

const ctxFor = (llm: StageContext['llm'], budgetUsd: number | null = null): StageContext => ({
  llm,
  clock: { now: () => 0 },
  logger: noopLogger,
  events: { emit: () => undefined },
  budget: createBudgetTracker(budgetUsd),
  trace: [],
})

const schema = z.object({ answer: z.number() })
const input = {
  lang: 'fr',
  stage: 'review' as const,
  role: 'reviewer',
  model: 'm',
  chunkIndex: 0,
  prompt: { system: 's', user: 'u' },
}

describe('callRoleJson', () => {
  it('parses fenced JSON and records a trace', async () => {
    const llm = createFakeLlm(() => 'Sure:\n```json\n{"answer": 42}\n```')
    const ctx = ctxFor(llm)
    const { value } = await callRoleJson(input, schema, ctx)
    expect(value).toEqual({ answer: 42 })
    expect(ctx.trace).toHaveLength(1)
    expect(ctx.trace[0]?.stage).toBe('review')
  })

  it('retries once with a repair prompt on invalid output', async () => {
    let n = 0
    const llm = createFakeLlm(() => (++n === 1 ? 'not json at all' : '{"answer": 7}'))
    const ctx = ctxFor(llm)
    const { value, usage } = await callRoleJson(input, schema, ctx)
    expect(value).toEqual({ answer: 7 })
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls[1]?.request.messages[1]?.content).toContain('not valid')
    expect(usage.promptTokens).toBe(20)
  })

  it('fails after two invalid answers', async () => {
    const llm = createFakeLlm(() => '{"answer": "nope"}')
    await expect(callRoleJson(input, schema, ctxFor(llm))).rejects.toThrow('invalid JSON twice')
  })

  it('stops when the budget is exceeded', async () => {
    const llm = createFakeLlm(() => '{"answer": 1}', {
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.5,
    })
    const ctx = ctxFor(llm, 0.4)
    await callRoleJson(input, schema, ctx)
    await expect(callRoleJson(input, schema, ctx)).rejects.toThrow('Budget')
  })
})
