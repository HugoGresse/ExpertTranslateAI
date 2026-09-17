import type { StageName } from '../types.ts'

/** Present-tense labels for progress displays, shared by every front end. */
export const STAGE_LABELS: Record<StageName, string> = {
  context: 'condensing context',
  brief: 'writing brief',
  translate: 'translating',
  review: 'reviewing',
  guidelines: 'auditing guidelines',
  judge: 'judging',
  finalize: 'finalizing',
  score: 'scoring',
  backtranslate: 'back-translating',
  glossary: 'suggesting glossary terms',
}
