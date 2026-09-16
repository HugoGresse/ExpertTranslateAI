import type { Repo, StoragePort } from '@experttranslate/core'

export interface InlineMaterials {
  contexts?: StoragePortRows<'contexts'>
  guidelines?: StoragePortRows<'guidelines'>
  glossaryScopes?: StoragePortRows<'glossaryScopes'>
  glossaryEntries?: StoragePortRows<'glossaryEntries'>
  tm?: StoragePortRows<'tm'>
}

type MaterialTable = keyof InlineMaterials
type StoragePortRows<K extends MaterialTable> = Awaited<ReturnType<StoragePort[K]['list']>>
type RowOf<K extends MaterialTable> = StoragePortRows<K>[number]

/** A repo that answers from the inline rows first and falls through to the base repo. */
function overlayRepo<T extends { id: string }>(base: Repo<T>, rows: T[]): Repo<T> {
  const inline = new Map(rows.map((row) => [row.id, row]))
  return {
    get: async (id) => inline.get(id) ?? (await base.get(id)),
    put: (row) => base.put(row),
    list: async () => {
      const seen = new Set(inline.keys())
      const rest = (await base.list()).filter((row) => !seen.has(row.id))
      return [...inline.values(), ...rest]
    },
    delete: (id) => base.delete(id),
  }
}

/**
 * Layers per-request materials over a persistent store so a caller (a browser talking to the
 * server, a one-off CLI run) can supply its own context, guidelines, glossary and memory rows
 * without writing them to disk. Results, jobs and evals still go to the base store.
 */
export function withInlineMaterials(base: StoragePort, materials: InlineMaterials): StoragePort {
  const layer = <K extends MaterialTable>(name: K): Repo<RowOf<K>> =>
    // The base repo for `name` is Repo<RowOf<K>> by construction; the indexed access loses that link.
    overlayRepo(base[name] as Repo<RowOf<K>>, (materials[name] ?? []) as RowOf<K>[])
  return {
    ...base,
    contexts: layer('contexts'),
    guidelines: layer('guidelines'),
    glossaryScopes: layer('glossaryScopes'),
    glossaryEntries: layer('glossaryEntries'),
    tm: layer('tm'),
  }
}
