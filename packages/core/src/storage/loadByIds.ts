import type { Repo } from '../ports.ts'

/** Point reads for a list of ids, dropping the ones that no longer exist. */
export async function loadByIds<T extends { id: string }>(
  repo: Repo<T>,
  ids: string[],
): Promise<T[]> {
  const out: T[] = []
  for (const item of await Promise.all(ids.map((id) => repo.get(id)))) if (item) out.push(item)
  return out
}
