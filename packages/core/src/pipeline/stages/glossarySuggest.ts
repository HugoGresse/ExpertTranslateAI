import { buildGlossarySuggestPrompt } from '../../prompts/glossarySuggest.ts'
import type { PromptMaterials } from '../../prompts/materials.ts'
import { glossarySuggestSchema } from '../../schemas/pipeline.ts'
import type { GlossarySuggestion } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

export interface GlossarySuggestInput {
  lang: string
  targetKey: string
  model: string
  sourceLang: string
  targetLabel: string
  sourceText: string
  finalText: string
  knownTerms: string[]
  materials: PromptMaterials
}

/** Asks the helper for source→target term pairs worth locking into the glossary. */
export async function suggestGlossary(
  input: GlossarySuggestInput,
  ctx: StageContext,
): Promise<GlossarySuggestion[]> {
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'glossary',
      role: 'helper',
      model: input.model,
      chunkIndex: null,
      prompt: buildGlossarySuggestPrompt(input),
      temperature: 0,
    },
    glossarySuggestSchema,
    ctx,
  )
  const known = new Set(input.knownTerms.map((t) => t.toLowerCase()))
  const seen = new Set<string>()
  const out: GlossarySuggestion[] = []
  for (const s of value) {
    const key = s.source.trim().toLowerCase()
    if (!key || known.has(key) || seen.has(key)) continue
    if (s.kind === 'preferred' && !s.target.trim()) continue
    seen.add(key)
    out.push({
      source: s.source.trim(),
      target: s.target.trim(),
      kind: s.kind,
      ...(s.note ? { note: s.note } : {}),
    })
  }
  return out
}
