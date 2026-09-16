import type { LlmPort } from '../ports.ts'
import type { ChatRequest, Usage } from '../types.ts'

export interface Collected {
  text: string
  usage: Usage
}

export async function collectText(
  llm: LlmPort,
  req: ChatRequest,
  signal?: AbortSignal,
): Promise<Collected> {
  let text = ''
  let usage: Usage = { promptTokens: 0, completionTokens: 0, costUsd: null }
  for await (const chunk of llm.chat(req, signal ? { signal } : undefined)) {
    if (chunk.type === 'delta') text += chunk.text
    else usage = chunk.usage
  }
  return { text: text.trim(), usage }
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidate = (fenced?.[1] ?? text).trim()
  const start = candidate.search(/[[{]/)
  if (start < 0) throw new Error('No JSON found in model output')
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
  return JSON.parse(candidate.slice(start, end + 1))
}
