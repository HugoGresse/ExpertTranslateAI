import { GLOSSARY_LEVELS, type GlossaryEntry, type GlossaryScope } from '../types.ts'

const levelRank = (scope: GlossaryScope | undefined): number =>
  scope ? GLOSSARY_LEVELS.indexOf(scope.level) : -1

const termKey = (entry: GlossaryEntry): string =>
  entry.caseSensitive ? entry.source.trim() : entry.source.trim().toLowerCase()

export function expandScopeIds(scopes: GlossaryScope[], selectedIds: string[]): Set<string> {
  const byId = new Map(scopes.map((s) => [s.id, s]))
  const out = new Set<string>()
  for (const id of selectedIds) {
    let current = byId.get(id)
    while (current && !out.has(current.id)) {
      out.add(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }
  return out
}

export function resolveGlossary(
  scopes: GlossaryScope[],
  entries: GlossaryEntry[],
  selectedIds: string[],
  lang: string,
): GlossaryEntry[] {
  const active = expandScopeIds(scopes, selectedIds)
  const byId = new Map(scopes.map((s) => [s.id, s]))
  const applicable = entries.filter(
    (e) => active.has(e.scopeId) && (e.kind === 'doNotTranslate' || e.lang === lang),
  )
  const winners = new Map<string, GlossaryEntry>()
  for (const entry of applicable) {
    const key =
      entry.kind === 'forbidden'
        ? `f:${termKey(entry)}:${entry.target.trim().toLowerCase()}`
        : `p:${termKey(entry)}`
    const current = winners.get(key)
    if (!current || levelRank(byId.get(entry.scopeId)) >= levelRank(byId.get(current.scopeId))) {
      winners.set(key, entry)
    }
  }
  return [...winners.values()].sort((a, b) => a.source.localeCompare(b.source))
}
