const words = (text: string): string[] => text.split(/\s+/).filter((w) => w.length > 0)

export function wordEditDistance(a: string, b: string): number {
  if (a === b) return 0
  const wa = words(a)
  const wb = words(b)
  const prev = new Array<number>(wb.length + 1)
  for (let j = 0; j <= wb.length; j++) prev[j] = j
  for (let i = 1; i <= wa.length; i++) {
    let diag = prev[0] ?? 0
    prev[0] = i
    for (let j = 1; j <= wb.length; j++) {
      const tmp = prev[j] ?? 0
      prev[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + 1,
        diag + (wa[i - 1] === wb[j - 1] ? 0 : 1),
      )
      diag = tmp
    }
  }
  return prev[wb.length] ?? 0
}
