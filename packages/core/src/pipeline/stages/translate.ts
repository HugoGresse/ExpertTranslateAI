import type { EventSink, LlmPort, LoggerPort, ClockPort } from '../../ports.ts'
import { buildTranslatePrompt, type TranslatePromptInput } from '../../prompts/translate.ts'
import type { Candidate, Chunk, TraceEvent, TranslatorRole, Usage } from '../../types.ts'

export interface TranslateStageInput {
  lang: string
  role: TranslatorRole
  model: string
  chunk: Chunk
  prompt: Omit<TranslatePromptInput, 'chunkText'>
}

export interface StageContext {
  llm: LlmPort
  clock: ClockPort
  logger: LoggerPort
  events: EventSink
  signal?: AbortSignal
}

export interface TranslateStageOutput {
  candidate: Candidate
  trace: TraceEvent
}

export async function translateChunk(
  input: TranslateStageInput,
  ctx: StageContext,
): Promise<TranslateStageOutput> {
  const prompt = buildTranslatePrompt({ ...input.prompt, chunkText: input.chunk.text })
  const started = ctx.clock.now()
  ctx.events.emit({
    type: 'stage-started',
    lang: input.lang,
    stage: 'translate',
    chunkIndex: input.chunk.index,
  })
  ctx.logger.debug('stage.translate.start', {
    lang: input.lang,
    chunk: input.chunk.index,
    model: input.model,
  })

  let text = ''
  let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: null }
  const stream = ctx.llm.chat(
    {
      model: input.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      temperature: 0.3,
    },
    ctx.signal ? { signal: ctx.signal } : undefined,
  )
  for await (const chunk of stream) {
    if (chunk.type === 'delta') {
      text += chunk.text
      ctx.events.emit({
        type: 'token',
        lang: input.lang,
        stage: 'translate',
        chunkIndex: input.chunk.index,
        delta: chunk.text,
      })
    } else {
      usage = chunk.usage
    }
  }

  const cleaned = text.trim()
  ctx.events.emit({
    type: 'stage-done',
    lang: input.lang,
    stage: 'translate',
    chunkIndex: input.chunk.index,
    usage,
  })
  ctx.logger.debug('stage.translate.done', {
    lang: input.lang,
    chunk: input.chunk.index,
    chars: cleaned.length,
    ...usage,
  })
  return {
    candidate: {
      chunkIndex: input.chunk.index,
      role: input.role,
      model: input.model,
      text: cleaned,
      usage,
    },
    trace: {
      at: started,
      lang: input.lang,
      stage: 'translate',
      role: input.role,
      model: input.model,
      chunkIndex: input.chunk.index,
      prompt,
      output: cleaned,
      usage,
      latencyMs: ctx.clock.now() - started,
    },
  }
}
