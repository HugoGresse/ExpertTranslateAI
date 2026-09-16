import type { NumberedRule } from '../../guidelines/format.ts'
import {
  buildGuidelineCheckPrompt,
  type GuidelineCheckPromptInput,
} from '../../prompts/guidelineCheck.ts'
import { guidelineCheckSchema } from '../../schemas/pipeline.ts'
import type { GuidelineViolation, TranslatorRole } from '../../types.ts'
import { callRoleJson, type StageContext } from '../call.ts'

export interface CandidateViolation extends GuidelineViolation {
  candidate: TranslatorRole
}

export async function checkChunkGuidelines(
  input: GuidelineCheckPromptInput & {
    lang: string
    targetKey: string
    model: string
    chunkIndex: number
    rules: NumberedRule[]
  },
  ctx: StageContext,
): Promise<CandidateViolation[]> {
  if (input.rules.length === 0) return []
  const { value } = await callRoleJson(
    {
      lang: input.lang,
      targetKey: input.targetKey,
      stage: 'guidelines',
      role: 'reviewer',
      model: input.model,
      chunkIndex: input.chunkIndex,
      prompt: buildGuidelineCheckPrompt(input),
      temperature: 0,
    },
    guidelineCheckSchema,
    ctx,
  )
  const byNumber = new Map(input.rules.map((r) => [r.number, r]))
  const out: CandidateViolation[] = []
  for (const v of value.violations) {
    const rule = byNumber.get(v.ruleNumber)
    if (!rule) continue
    out.push({
      ruleId: rule.rule.id,
      ruleText: rule.rule.text,
      severity: rule.rule.kind === 'prefer' ? 'minor' : v.severity,
      candidate: v.candidate,
      explanation: v.explanation,
      ...(v.targetSpan ? { targetSpan: v.targetSpan } : {}),
    })
  }
  return out
}
