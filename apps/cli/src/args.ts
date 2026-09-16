import { parseArgs } from 'node:util'
import type { Difficulty, Domain, ReasoningEffort, Target } from '@experttranslate/core'

export interface TranslateArgs {
  command: 'translate'
  input: string | null
  targets: Target[]
  sourceLang: string
  domain: Domain | 'auto'
  difficulty: Difficulty | 'auto'
  model: string
  models: Partial<
    Record<
      | 'translatorB'
      | 'translatorC'
      | 'reviewer'
      | 'judge'
      | 'finalizer'
      | 'scorer'
      | 'backTranslator'
      | 'helper',
      string
    >
  >
  reasoning: ReasoningEffort
  budgetUsd: number | null
  maxTokensPerChunk: number
  contexts: string[]
  guidelineFiles: string[]
  guidelineSetIds: string[]
  glossaryScopeIds: string[]
  useMemory: boolean
  autoEscalate: boolean
  backTranslate: boolean
  tone: string | undefined
  audience: string | undefined
  formality: 'formal' | 'informal' | 'auto'
  outDir: string | null
  json: boolean
  concurrency: number
}

export interface ModelsArgs {
  command: 'models'
  filter: string | null
}

export interface ImportArgs {
  command: 'import'
  file: string
}

export interface KeyArgs {
  command: 'key'
}

export interface HelpArgs {
  command: 'help'
}

export interface CommonArgs {
  dataDir: string | null
  logLevel: string | undefined
}

export type CliArgs = (TranslateArgs | ModelsArgs | ImportArgs | KeyArgs | HelpArgs) & CommonArgs

export const USAGE = `Usage:
  eta translate [file|-] --to fr,es-MX [options]   Translate a file (or stdin) into one or more languages
  eta models [--filter text]                        List OpenRouter models
  eta key                                           Show the OpenRouter key label and usage
  eta import <export.json>                          Load materials exported from the web app

Translate options:
  --to <langs>            Comma-separated targets; "es-MX" or "es:Mexico" adds a region
  --from <lang>           Source language (default: auto)
  --model <id>            Translator model (default: anthropic/claude-sonnet-4.5)
  --translator-b, --translator-c, --reviewer, --judge, --finalizer, --scorer,
  --back-translator, --helper <id>   Override a role model (default: --model)
  --difficulty <level>    auto | simple | normal | hard (default: auto)
  --domain <name>         auto | general | legal | technical | marketing | medical | literary | ui
  --reasoning <effort>    none | minimal | low | medium | high (default: low)
  --budget <usd>          Abort when the projected spend exceeds this amount
  --chunk-tokens <n>      Max tokens per chunk (default: 1000)
  --context <url|file>    Context source (llms.txt, Markdown, text); repeatable
  --guidelines <file>     Guideline text file; repeatable
  --guideline-set <id>    Stored guideline set id; repeatable
  --glossary-scope <id>   Stored glossary scope id; repeatable
  --memory                Use the translation memory in the data dir
  --no-escalate           Never escalate difficulty automatically
  --back-translate        Back-translate and list meaning deltas
  --tone, --audience <text>, --formality formal|informal
  --out <dir>             Write <targetKey>.txt per target instead of stdout
  --json                  Print the full result objects as JSON
  --concurrency <n>       Parallel model calls (default: 4)

Common options:
  --data-dir <dir>        Storage directory (default: $ETA_DATA_DIR or ~/.experttranslate)
  --log-level <level>     debug | info | warn | error | silent (default: $ETA_LOG_LEVEL or warn)
  -h, --help

The OpenRouter key is read from $OPENROUTER_API_KEY.`

const DOMAINS = [
  'auto',
  'general',
  'legal',
  'technical',
  'marketing',
  'medical',
  'literary',
  'ui',
] as const
const DIFFICULTIES = ['auto', 'simple', 'normal', 'hard'] as const
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
const FORMALITIES = ['auto', 'formal', 'informal'] as const

function oneOf<const T extends readonly string[]>(
  allowed: T,
  value: string | undefined,
  flag: string,
  fallback: T[number],
): T[number] {
  if (value === undefined) return fallback
  const found = allowed.find((a) => a === value)
  if (found === undefined)
    throw new Error(`${flag} must be one of ${allowed.join(', ')} (got "${value}")`)
  return found
}

function positiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${flag} must be a positive integer (got "${value}")`)
  return n
}

export function parseTargets(raw: string): Target[] {
  const targets: Target[] = []
  for (const part of raw.split(',')) {
    const spec = part.trim()
    if (!spec) continue
    const [lang, region] = spec.split(/[:-]/, 2).map((s) => s.trim())
    if (!lang) throw new Error(`Invalid target "${spec}"`)
    targets.push(region ? { lang: lang.toLowerCase(), region } : { lang: lang.toLowerCase() })
  }
  if (targets.length === 0) throw new Error('--to needs at least one language')
  return targets
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      to: { type: 'string' },
      from: { type: 'string' },
      model: { type: 'string' },
      'translator-b': { type: 'string' },
      'translator-c': { type: 'string' },
      reviewer: { type: 'string' },
      judge: { type: 'string' },
      finalizer: { type: 'string' },
      scorer: { type: 'string' },
      'back-translator': { type: 'string' },
      helper: { type: 'string' },
      difficulty: { type: 'string' },
      domain: { type: 'string' },
      reasoning: { type: 'string' },
      budget: { type: 'string' },
      'chunk-tokens': { type: 'string' },
      context: { type: 'string', multiple: true },
      guidelines: { type: 'string', multiple: true },
      'guideline-set': { type: 'string', multiple: true },
      'glossary-scope': { type: 'string', multiple: true },
      memory: { type: 'boolean' },
      'no-escalate': { type: 'boolean' },
      'back-translate': { type: 'boolean' },
      tone: { type: 'string' },
      audience: { type: 'string' },
      formality: { type: 'string' },
      out: { type: 'string' },
      json: { type: 'boolean' },
      concurrency: { type: 'string' },
      filter: { type: 'string' },
      'data-dir': { type: 'string' },
      'log-level': { type: 'string' },
    },
  })
  const common: CommonArgs = { dataDir: values['data-dir'] ?? null, logLevel: values['log-level'] }
  const [command, ...rest] = positionals
  if (values.help || command === undefined || command === 'help')
    return { command: 'help', ...common }
  switch (command) {
    case 'translate': {
      if (!values.to) throw new Error('--to is required')
      const budget = values.budget === undefined ? null : Number(values.budget)
      if (budget !== null && !(budget > 0))
        throw new Error(`--budget must be a positive number (got "${values.budget}")`)
      const models: TranslateArgs['models'] = {}
      if (values['translator-b']) models.translatorB = values['translator-b']
      if (values['translator-c']) models.translatorC = values['translator-c']
      if (values.reviewer) models.reviewer = values.reviewer
      if (values.judge) models.judge = values.judge
      if (values.finalizer) models.finalizer = values.finalizer
      if (values.scorer) models.scorer = values.scorer
      if (values['back-translator']) models.backTranslator = values['back-translator']
      if (values.helper) models.helper = values.helper
      return {
        command: 'translate',
        input: rest[0] ?? null,
        targets: parseTargets(values.to),
        sourceLang: values.from?.trim() || 'auto',
        domain: oneOf(DOMAINS, values.domain, '--domain', 'auto'),
        difficulty: oneOf(DIFFICULTIES, values.difficulty, '--difficulty', 'auto'),
        model: values.model?.trim() || 'anthropic/claude-sonnet-4.5',
        models,
        reasoning: oneOf(EFFORTS, values.reasoning, '--reasoning', 'low'),
        budgetUsd: budget,
        maxTokensPerChunk: positiveInt(values['chunk-tokens'], '--chunk-tokens', 1000),
        contexts: values.context ?? [],
        guidelineFiles: values.guidelines ?? [],
        guidelineSetIds: values['guideline-set'] ?? [],
        glossaryScopeIds: values['glossary-scope'] ?? [],
        useMemory: values.memory ?? false,
        autoEscalate: !(values['no-escalate'] ?? false),
        backTranslate: values['back-translate'] ?? false,
        tone: values.tone,
        audience: values.audience,
        formality: oneOf(FORMALITIES, values.formality, '--formality', 'auto'),
        outDir: values.out ?? null,
        json: values.json ?? false,
        concurrency: positiveInt(values.concurrency, '--concurrency', 4),
        ...common,
      }
    }
    case 'models':
      return { command: 'models', filter: values.filter ?? null, ...common }
    case 'key':
      return { command: 'key', ...common }
    case 'import': {
      const file = rest[0]
      if (!file) throw new Error('import needs the path of a web export file')
      return { command: 'import', file, ...common }
    }
    default:
      throw new Error(`Unknown command "${command}"`)
  }
}
