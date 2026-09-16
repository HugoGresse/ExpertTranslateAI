import type { Repo } from '@experttranslate/core'
import { useCallback, useEffect, useState } from 'react'

export interface RepoState<T extends { id: string }> {
  items: T[]
  reload: () => Promise<void>
  save: (item: T) => Promise<void>
  remove: (id: string) => Promise<void>
}

export function useRepo<T extends { id: string }>(repo: Repo<T>): RepoState<T> {
  const [items, setItems] = useState<T[]>([])
  const reload = useCallback(async () => setItems(await repo.list()), [repo])
  useEffect(() => {
    void reload()
  }, [reload])
  const save = useCallback(
    async (item: T) => {
      await repo.put(item)
      await reload()
    },
    [repo, reload],
  )
  const remove = useCallback(
    async (id: string) => {
      await repo.delete(id)
      await reload()
    },
    [repo, reload],
  )
  return { items, reload, save, remove }
}
