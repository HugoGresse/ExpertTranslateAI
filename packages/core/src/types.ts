export type LanguageCode = string

export const AUTO_LANG = 'auto'

export type Difficulty = 'simple' | 'normal' | 'hard' | 'critical'

export type Domain = 'general' | 'legal' | 'technical' | 'marketing' | 'medical' | 'literary' | 'ui'

export interface Target {
  lang: LanguageCode
  region?: string
}

export interface JobOptions {
  tone?: string
  audience?: string
  formality?: 'formal' | 'informal' | 'auto'
  preserveFormatting: boolean
  maxTokensPerChunk: number
  contextSourceIds: string[]
  guidelineSetIds: string[]
  contextTokenBudget: number
  guidelinesTokenBudget: number
  budgetUsd: number | null
  reasoningEffort: ReasoningEffort
  glossaryScopeIds: string[]
  useMemory: boolean
  autoEscalate: boolean
  escalationConfidence: number
  routing: RouterRule[]
}

export interface RouterRule {
  domain: Domain
  role: Role
  model: string
}

export type DisagreementSeverity = 'low' | 'medium' | 'high'

export interface Disagreement {
  chunkIndex: number
  sentenceIndex: number
  variants: Partial<Record<TranslatorRole, string>>
  similarity: number
  severity: DisagreementSeverity
  reasons: string[]
}

export interface Escalation {
  chunkIndex: number | null
  from: Difficulty
  to: Difficulty
  reason: string
}

export type GlossaryLevel = 'global' | 'language' | 'client' | 'project' | 'document'

export const GLOSSARY_LEVELS: GlossaryLevel[] = [
  'global',
  'language',
  'client',
  'project',
  'document',
]

export interface GlossaryScope {
  id: string
  level: GlossaryLevel
  name: string
  lang?: LanguageCode
  parentId?: string
  createdAt: number
}

export type GlossaryKind = 'preferred' | 'forbidden' | 'doNotTranslate'

export interface GlossaryEntry {
  id: string
  scopeId: string
  source: string
  target: string
  lang: LanguageCode
  kind: GlossaryKind
  caseSensitive: boolean
  note?: string
  createdAt: number
}

export interface TermViolation {
  entryId: string
  kind: GlossaryKind
  source: string
  expected: string
  found?: string
  severity: 'major'
  explanation: string
}

export interface TmEntry {
  id: string
  sourceLang: LanguageCode
  targetLang: LanguageCode
  source: string
  target: string
  origin: 'human-correction' | 'accepted-output'
  createdAt: number
}

export interface MemoryHit {
  source: string
  target: string
  similarity: number
  entryId: string
}

export interface Brief {
  detectedLang: LanguageCode
  domain: Domain
  difficulty: Difficulty
  summary: string
  tone: string
  audience: string
  keyTerms: { term: string; note: string }[]
  risks: string[]
}

export type IssueCategory =
  | 'accuracy'
  | 'omission'
  | 'addition'
  | 'terminology'
  | 'grammar'
  | 'fluency'
  | 'style'
  | 'consistency'
  | 'formatting'
  | 'guideline'

export type IssueSeverity = 'minor' | 'major' | 'critical'

export interface Issue {
  candidate: TranslatorRole
  category: IssueCategory
  severity: IssueSeverity
  sourceSpan?: string
  targetSpan?: string
  explanation: string
  fix?: string
}

export interface Review {
  chunkIndex: number
  model: string
  issues: Issue[]
  suggestions: string[]
  preferred: TranslatorRole | null
}

export interface Judgment {
  chunkIndex: number
  model: string
  winner: TranslatorRole | 'merge'
  rationale: string
  mergedText?: string
}

export interface QualityScore {
  fidelity: number
  terminology: number
  grammar: number
  naturalness: number
  register: number
  consistency: number
  overall: number
  confidence: number
  notes: string[]
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`Budget of $${budgetUsd.toFixed(4)} exceeded (spent $${spentUsd.toFixed(4)})`)
    this.name = 'BudgetExceededError'
  }
}

export type ContextKind = 'llms-txt' | 'markdown-url' | 'markdown-file' | 'pasted'

export interface ContextDigest {
  text: string
  model: string
  tokenEstimate: number
  forHash: string
}

export interface ContextSource {
  id: string
  name: string
  kind: ContextKind
  url?: string
  rawText: string
  contentHash: string
  fetchedAt?: number
  condensed?: ContextDigest
  enabled: boolean
  lang?: LanguageCode
  createdAt: number
}

export type GuidelineKind = 'must' | 'must-not' | 'prefer' | 'keep'

export interface GuidelineRule {
  id: string
  text: string
  kind: GuidelineKind
  pattern?: string
  examples?: { good?: string; bad?: string }
}

export interface GuidelineSet {
  id: string
  name: string
  rules: GuidelineRule[]
  freeText?: string
  enabled: boolean
  lang?: LanguageCode
  createdAt: number
}

export interface GuidelineViolation {
  ruleId: string
  ruleText: string
  severity: 'minor' | 'major'
  targetSpan?: string
  explanation: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface RoleModels {
  translatorA: string
  translatorB: string
  translatorC: string
  reviewer: string
  judge: string
  finalizer: string
  scorer: string
  helper: string
}

export type Role = keyof RoleModels

export interface TranslationJob {
  id: string
  createdAt: number
  sourceText: string
  sourceLang: LanguageCode
  targets: Target[]
  domain: Domain | 'auto'
  difficulty: Difficulty | 'auto'
  models: RoleModels
  options: JobOptions
  status: JobStatus
}

export interface Usage {
  promptTokens: number
  completionTokens: number
  costUsd: number | null
}

export interface Chunk {
  index: number
  text: string
  tokenEstimate: number
}

export type TranslatorRole = 'translatorA' | 'translatorB' | 'translatorC'

export interface Candidate {
  chunkIndex: number
  role: TranslatorRole
  model: string
  text: string
  usage: Usage
}

export interface CostSummary {
  usd: number
  tokensIn: number
  tokensOut: number
  calls: number
}

export interface TraceEvent {
  at: number
  lang: LanguageCode
  stage: StageName
  role: string
  model: string
  chunkIndex: number | null
  prompt: { system: string; user: string }
  output: string
  usage: Usage
  latencyMs: number
}

export interface TargetResult {
  jobId: string
  lang: LanguageCode
  chunks: Chunk[]
  placeholders: Record<string, string>
  candidates: Candidate[]
  finalText: string
  brief: Brief | null
  plan: { difficulty: Difficulty; translators: TranslatorRole[] }
  reviews: Review[]
  judgments: Judgment[]
  score: QualityScore | null
  guidelineReport: GuidelineViolation[]
  terminologyReport: TermViolation[]
  memoryHits: MemoryHit[]
  disagreements: Disagreement[]
  escalations: Escalation[]
  cost: CostSummary
  trace: TraceEvent[]
  status: 'done' | 'failed' | 'cancelled'
  error?: string
}

export type StageName =
  | 'context'
  | 'brief'
  | 'translate'
  | 'review'
  | 'guidelines'
  | 'judge'
  | 'finalize'
  | 'score'

export type ProgressEvent =
  | { type: 'job-started'; jobId: string; targets: Target[] }
  | { type: 'brief-done'; brief: Brief }
  | {
      type: 'target-started'
      lang: LanguageCode
      chunkCount: number
      placeholders: Record<string, string>
    }
  | {
      type: 'stage-started'
      lang: LanguageCode
      stage: StageName
      role: string
      chunkIndex: number | null
    }
  | {
      type: 'token'
      lang: LanguageCode
      stage: StageName
      role: string
      chunkIndex: number
      delta: string
    }
  | {
      type: 'stage-done'
      lang: LanguageCode
      stage: StageName
      role: string
      chunkIndex: number | null
      usage: Usage
    }
  | { type: 'target-done'; lang: LanguageCode; result: TargetResult }
  | {
      type: 'escalated'
      lang: LanguageCode
      chunkIndex: number | null
      from: Difficulty
      to: Difficulty
      reason: string
    }
  | { type: 'target-failed'; lang: LanguageCode; error: string }
  | { type: 'job-done'; jobId: string; cost: CostSummary }

export interface ModelPricing {
  promptUsdPerToken: number
  completionUsdPerToken: number
}

export interface ModelInfo {
  id: string
  name: string
  contextLength: number
  pricing: ModelPricing
  supportsStructuredOutput: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  reasoningEffort?: ReasoningEffort
  responseFormat?: { type: 'json_object' } | { type: 'json_schema'; jsonSchema: unknown }
}

export type ChatChunk = { type: 'delta'; text: string } | { type: 'usage'; usage: Usage }

export interface KeyInfo {
  label: string
  limitUsd: number | null
  usageUsd: number
  isFreeTier: boolean
}

export interface JobEstimate {
  sourceTokens: number
  contextTokens: number
  chunkCount: number
  callCount: number
  estimatedUsd: number | null
  difficulty: Difficulty
}
