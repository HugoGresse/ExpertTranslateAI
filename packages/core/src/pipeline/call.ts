import type { ZodType } from 'zod'
import { collectText, extractJson } from '../llm/collect.ts'
import type { ClockPort, EventSink, LlmPort, LoggerPort } from '../ports.ts'
import type { Prompt } from '../prompts/translate.ts'
import type { ChatMessage, ReasoningEffort, StageName, TraceEvent, Usage } from '../types.ts'
import type { BudgetTracker } from './budget.ts'

export interface StageContext {
  llm: LlmPort
  clock: ClockPort
  logger: LoggerPort
  events: EventSink
  budget: BudgetTracker
  trace: TraceEvent[]
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
}

export interface CallInput {
  lang: string
  targetKey: string
  stage: StageName
  role: string
  model: string
  chunkIndex: number | null
  prompt: Prompt
  temperature?: number
  stream?: boolean
}

export interface CallOutput {
  text: string
  usage: Usage
}

const messages = (prompt: Prompt): ChatMessage[] => [
  { role: 'system', content: prompt.system },
  { role: 'user', content: prompt.user },
]

export async function callRole(input: CallInput, ctx: StageContext): Promise<CallOutput> {
  ctx.budget.check()
  ctx.budget.begin()
  try {
    return await performCall(input, ctx)
  } finally {
    ctx.budget.end()
  }
}

async function performCall(input: CallInput, ctx: StageContext): Promise<CallOutput> {
  const started = ctx.clock.now()
  ctx.events.emit({
    type: 'stage-started',
    lang: input.lang,
    targetKey: input.targetKey,
    stage: input.stage,
    role: input.role,
    chunkIndex: input.chunkIndex,
  })
  ctx.logger.debug('stage.start', {
    stage: input.stage,
    role: input.role,
    lang: input.lang,
    chunk: input.chunkIndex,
    model: input.model,
  })
  const req = {
    model: input.model,
    messages: messages(input.prompt),
    temperature: input.temperature ?? 0.2,
    ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
  }

  let text = ''
  let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: null }
  if (input.stream && input.chunkIndex !== null) {
    for await (const chunk of ctx.llm.chat(req, ctx.signal ? { signal: ctx.signal } : undefined)) {
      if (chunk.type === 'delta') {
        text += chunk.text
        ctx.events.emit({
          type: 'token',
          lang: input.lang,
          targetKey: input.targetKey,
          stage: input.stage,
          role: input.role,
          chunkIndex: input.chunkIndex,
          delta: chunk.text,
        })
      } else usage = chunk.usage
    }
    text = text.trim()
  } else {
    ;({ text, usage } = await collectText(ctx.llm, req, ctx.signal))
  }

  ctx.budget.spend(usage)
  ctx.trace.push({
    at: started,
    lang: input.lang,
    stage: input.stage,
    role: input.role,
    model: input.model,
    chunkIndex: input.chunkIndex,
    prompt: input.prompt,
    output: text,
    usage,
    latencyMs: ctx.clock.now() - started,
  })
  ctx.events.emit({
    type: 'stage-done',
    lang: input.lang,
    targetKey: input.targetKey,
    stage: input.stage,
    role: input.role,
    chunkIndex: input.chunkIndex,
    usage,
  })
  ctx.logger.debug('stage.done', {
    stage: input.stage,
    role: input.role,
    lang: input.lang,
    chunk: input.chunkIndex,
    chars: text.length,
    ...usage,
  })
  return { text, usage }
}

export async function callRoleJson<T>(
  input: CallInput,
  schema: ZodType<T>,
  ctx: StageContext,
): Promise<{ value: T; usage: Usage }> {
  const first = await callRole(input, ctx)
  const parsed = tryParse(first.text, schema)
  if (parsed.ok) return { value: parsed.value, usage: first.usage }
  ctx.logger.warn('stage.invalidJson', {
    stage: input.stage,
    role: input.role,
    error: parsed.error,
  })
  const repairPrompt: Prompt = {
    system: input.prompt.system,
    user: `${input.prompt.user}\n\nYour previous answer was not valid for the required JSON shape (${parsed.error}). Answer again with only the JSON object, no prose, no code fences.`,
  }
  const second = await callRole({ ...input, prompt: repairPrompt, temperature: 0 }, ctx)
  const again = tryParse(second.text, schema)
  if (!again.ok)
    throw new Error(`${input.stage} (${input.role}) returned invalid JSON twice: ${again.error}`)
  return {
    value: again.value,
    usage: {
      promptTokens: first.usage.promptTokens + second.usage.promptTokens,
      completionTokens: first.usage.completionTokens + second.usage.completionTokens,
      costUsd:
        first.usage.costUsd === null && second.usage.costUsd === null
          ? null
          : (first.usage.costUsd ?? 0) + (second.usage.costUsd ?? 0),
    },
  }
}

function tryParse<T>(
  text: string,
  schema: ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = extractJson(text)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'unparseable' }
  }
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, value: result.data }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  }
}
