const BOUNDARY = /(?<=[.!?…]["'”’)\]]?)\s+(?=[^\s])|\n+/u

export function splitSentences(text: string): string[] {
  return text
    .split(BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
