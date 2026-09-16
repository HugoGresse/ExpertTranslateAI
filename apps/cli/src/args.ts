import { parseArgs } from 'node:util'
import {
  DEFAULT_JOB_OPTIONS,
  DEFAULT_MODEL,
  type Difficulty,
  type Domain,
  type ReasoningEffort,
  type RoleModels,
  type Target,
} from '@experttranslate/core'

/** Role → flag name; the options table, the parser and USAGE all derive from this one map. */
export const ROLE_FLAGS = {
  translatorB: 'translator-b',
  translatorC: 'translator-c',
  reviewer: 'reviewer',
  judge: 'judge',
  finalizer: 'finalizer',
  scorer: 'scorer',
  backTranslator: 'back-translator',
  helper: 'helper',
} as const satisfies Partial<Record<keyof RoleModels, string>>
export type OverridableRole = keyof typeof ROLE_FLAGS

export interface CommonArgs {
  dataDir: string | null
  logLevel: string | undefined
}

export interface TranslateArgs extends CommonArgs {
  command: 'translate'
  input: string | null
  targets: Target[]
  sourceLang: string
  domain: Domain | 'auto'
  difficulty: Difficulty | 'auto'
  model: string
  models: Partial<Record<OverridableRole, string>>
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

export interface ModelsArgs extends CommonArgs {
  command: 'models'
  filter: string | null
}

export interface ImportArgs extends CommonArgs {
  command: 'import'
  file: string
}

export interface KeyArgs extends CommonArgs {
  command: 'key'
}

export interface HelpArgs extends CommonArgs {
  command: 'help'
}

export type CliArgs = TranslateArgs | ModelsArgs | ImportArgs | KeyArgs | HelpArgs

const roleFlagList = Object.values(ROLE_FLAGS)
  .map((f) => `--${f}`)
  .join(', ')

export const USAGE = `Usage:
  eta translate [file|-] --to fr,pt-BR [options]   Translate a file (or stdin) into one or more languages
  eta models [--filter text]                        List OpenRouter models
  eta key                                           Show the OpenRouter key label and usage
  eta import <export.json>                          Load materials exported from the web app

Translate options:
  --to <targets>          Comma-separated language codes as used in the web app (fr, pt-BR, zh-Hans);
                          append ":Region" for a regional variant, e.g. es:Mexico
  --from <lang>           Source language (default: auto)
  --model <id>            Translator model (default: ${DEFAULT_MODEL})
  ${roleFlagList} <id>
                          Override a role model; unset roles follow the same fallback chain as the web app
  --difficulty <level>    auto | simple | normal | hard (default: auto)
  --domain <name>         auto | general | legal | technical | marketing | medical | literary | ui
  --reasoning <effort>    none | minimal | low | medium | high (default: ${DEFAULT_JOB_OPTIONS.reasoningEffort})
  --budget <usd>          Abort when the projected spend exceeds this amount
  --chunk-tokens <n>      Max tokens per chunk (default: ${DEFAULT_JOB_OPTIONS.maxTokensPerChunk})
  --context <url|file>    Context source (llms.txt, Markdown, text); repeatable, cached by content
  --guidelines <file>     Guideline text file; rules are extracted once with the helper model and cached
  --guideline-set <id>    Stored guideline set id; repeatable
  --glossary-scope <id>   Stored glossary scope id; repeatable
  --memory                Use the translation memory in the data dir
  --no-escalate           Never escalate difficulty automatically
  --back-translate        Back-translate and list meaning deltas
  --tone, --audience <text>, --formality formal|informal
  --out <dir>             Write <target>.txt per target (combinable with --json)
  --json                  Print the full result objects as JSON on stdout
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

/** `fr`, `pt-BR`, `zh-Hans` are language codes as in the web app; only `:` introduces a region. */
export function parseTargets(raw: string): Target[] {
  const targets: Target[] = []
  for (const part of raw.split(',')) {
    const spec = part.trim()
    if (!spec) continue
    const colon = spec.indexOf(':')
    const lang = (colon === -1 ? spec : spec.slice(0, colon)).trim()
    const region = colon === -1 ? '' : spec.slice(colon + 1).trim()
    if (!lang) throw new Error(`Invalid target "${spec}"`)
    targets.push(region ? { lang, region } : { lang })
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
      ...Object.fromEntries(Object.values(ROLE_FLAGS).map((flag) => [flag, { type: 'string' }])),
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
  // parseArgs infers an exact shape; the accessors below only need its index signature.
  const raw: Record<string, string | boolean | Array<string | boolean> | undefined> = values
  const str = (name: string): string | undefined => {
    const v = raw[name]
    return typeof v === 'string' ? v : undefined
  }
  const strs = (name: string): string[] => {
    const v = raw[name]
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }
  const flag = (name: string): boolean => raw[name] === true
  const common: CommonArgs = { dataDir: str('data-dir') ?? null, logLevel: str('log-level') }
  const [command, ...rest] = positionals
  if (flag('help') || command === undefined || command === 'help')
    return { command: 'help', ...common }
  switch (command) {
    case 'translate': {
      const to = str('to')
      if (!to) throw new Error('--to is required')
      const rawBudget = str('budget')
      const budget = rawBudget === undefined ? null : Number(rawBudget)
      if (budget !== null && !(budget > 0))
        throw new Error(`--budget must be a positive number (got "${rawBudget}")`)
      const models: Partial<Record<OverridableRole, string>> = {}
      for (const [role, flagName] of Object.entries(ROLE_FLAGS) as Array<
        [OverridableRole, string]
      >) {
        const value = str(flagName)
        if (value) models[role] = value
      }
      return {
        command: 'translate',
        input: rest[0] ?? null,
        targets: parseTargets(to),
        sourceLang: str('from')?.trim() || 'auto',
        domain: oneOf(DOMAINS, str('domain'), '--domain', 'auto'),
        difficulty: oneOf(DIFFICULTIES, str('difficulty'), '--difficulty', 'auto'),
        model: str('model')?.trim() || DEFAULT_MODEL,
        models,
        reasoning: oneOf(
          EFFORTS,
          str('reasoning'),
          '--reasoning',
          DEFAULT_JOB_OPTIONS.reasoningEffort,
        ),
        budgetUsd: budget,
        maxTokensPerChunk: positiveInt(
          str('chunk-tokens'),
          '--chunk-tokens',
          DEFAULT_JOB_OPTIONS.maxTokensPerChunk,
        ),
        contexts: strs('context'),
        guidelineFiles: strs('guidelines'),
        guidelineSetIds: strs('guideline-set'),
        glossaryScopeIds: strs('glossary-scope'),
        useMemory: flag('memory'),
        autoEscalate: !flag('no-escalate'),
        backTranslate: flag('back-translate'),
        tone: str('tone'),
        audience: str('audience'),
        formality: oneOf(FORMALITIES, str('formality'), '--formality', 'auto'),
        outDir: str('out') ?? null,
        json: flag('json'),
        concurrency: positiveInt(str('concurrency'), '--concurrency', 4),
        ...common,
      }
    }
    case 'models':
      return { command: 'models', filter: str('filter') ?? null, ...common }
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
