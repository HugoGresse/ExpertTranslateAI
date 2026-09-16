import type { RemoteMaterials, Repo, StoragePort } from '@experttranslate/core'

/**
 * A repo that answers from the inline rows first and falls through to the base repo for reads.
 * Writes stay in the inline map: the base store never sees per-request material rows.
 */
function overlayRepo<T extends { id: string }>(base: Repo<T>, rows: T[]): Repo<T> {
  const inline = new Map(rows.map((row) => [row.id, row]))
  return {
    get: async (id) => inline.get(id) ?? (await base.get(id)),
    put: (row) => {
      inline.set(row.id, row)
      return Promise.resolve()
    },
    list: async () => {
      const rest = (await base.list()).filter((row) => !inline.has(row.id))
      return [...inline.values(), ...rest]
    },
    delete: (id) => {
      inline.delete(id)
      return Promise.resolve()
    },
  }
}

/**
 * Layers per-request materials over a store so a caller (a browser talking to the server, a
 * one-off CLI run) can supply its own context, guidelines, glossary and memory rows without
 * writing them to disk. Jobs, results and evals still go to the base store.
 */
export function withInlineMaterials(
  base: StoragePort,
  materials: Partial<RemoteMaterials>,
): StoragePort {
  return {
    ...base,
    contexts: overlayRepo(base.contexts, materials.contexts ?? []),
    guidelines: overlayRepo(base.guidelines, materials.guidelines ?? []),
    glossaryScopes: overlayRepo(base.glossaryScopes, materials.glossaryScopes ?? []),
    glossaryEntries: overlayRepo(base.glossaryEntries, materials.glossaryEntries ?? []),
    tm: overlayRepo(base.tm, materials.tm ?? []),
  }
}
