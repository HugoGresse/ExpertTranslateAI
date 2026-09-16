export const isOneOf =
  <T extends string>(options: readonly T[]) =>
  (value: string): value is T =>
    (options as readonly string[]).includes(value)

export function pickOneOf<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return isOneOf(options)(value) ? value : fallback
}
