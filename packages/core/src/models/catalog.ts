import type { ModelInfo } from '../types.ts'

/**
 * Authors treated as "major": their newest models are pinned at the top of the picker and their
 * groups sort first, in this order. Ported from PlantTaxoMatcher's shared catalogue helpers.
 */
export const MAJOR_MODEL_AUTHORS = [
  'anthropic',
  'openai',
  'google',
  'meta-llama',
  'mistralai',
  'deepseek',
  'qwen',
  'x-ai',
  'moonshotai',
] as const

export const LATEST_MAJOR_COUNT = 5

/** Author slug (before `/`), with an alias's leading `~` stripped. */
export function modelAuthor(id: string): string {
  const slug = id.startsWith('~') ? id.slice(1) : id
  const i = slug.indexOf('/')
  return i === -1 ? slug : slug.slice(0, i)
}

/** Auto-updating pointers such as `~anthropic/claude-haiku-latest` or `openai/gpt-chat-latest`. */
export const isAliasModel = (id: string): boolean => id.startsWith('~') || /-latest$/i.test(id)

/** Compact "$3 · $15 /M" (in · out) label, "Free", or null when the price is unknown. */
export function formatModelPrice(m: ModelInfo): string | null {
  const p = m.pricing.promptUsdPerToken
  const c = m.pricing.completionUsdPerToken
  if (p < 0 || c < 0) return 'variable'
  if (p === 0 && c === 0) return 'Free'
  const perM = (v: number): string => {
    const n = v * 1_000_000
    return n >= 100 ? `$${Math.round(n)}` : `$${Number(n.toFixed(2))}`
  }
  return `${perM(p)} · ${perM(c)} /M`
}

export function formatContext(tokens: number): string | null {
  if (!tokens) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M ctx`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`
  return `${tokens} ctx`
}

export interface ModelGroup {
  author: string
  models: ModelInfo[]
}
export interface GroupedModels {
  pinned: ModelInfo[]
  groups: ModelGroup[]
}

const majorRank = (author: string): number => {
  const i = (MAJOR_MODEL_AUTHORS as readonly string[]).indexOf(author)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/**
 * Picker structure from a flat catalog: the newest models of major authors pinned first, then one
 * group per author (major authors first, others alphabetically) with aliases before concrete
 * models, newest first. Pure.
 */
export function groupModels(
  models: ModelInfo[],
  latestCount: number = LATEST_MAJOR_COUNT,
): GroupedModels {
  const created = (m: ModelInfo): number => m.created ?? 0
  const pinned = models
    .filter((m) => majorRank(modelAuthor(m.id)) !== Number.MAX_SAFE_INTEGER && !isAliasModel(m.id))
    .sort((a, b) => created(b) - created(a))
    .slice(0, latestCount)
  const byAuthor = new Map<string, ModelInfo[]>()
  for (const m of models) {
    const author = modelAuthor(m.id)
    const list = byAuthor.get(author)
    if (list) list.push(m)
    else byAuthor.set(author, [m])
  }
  const groups: ModelGroup[] = [...byAuthor.entries()]
    .map(([author, list]) => ({
      author,
      models: [...list].sort((a, b) => {
        const aa = isAliasModel(a.id)
        const ab = isAliasModel(b.id)
        if (aa !== ab) return aa ? -1 : 1
        return created(b) - created(a) || a.id.localeCompare(b.id)
      }),
    }))
    .sort((a, b) => majorRank(a.author) - majorRank(b.author) || a.author.localeCompare(b.author))
  return { pinned, groups }
}
