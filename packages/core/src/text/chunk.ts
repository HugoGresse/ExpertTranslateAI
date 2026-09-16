import type { Chunk } from '../types.ts'
import { PLACEHOLDER_CLOSE, PLACEHOLDER_OPEN } from './placeholders.ts'
import { countTokens } from './tokens.ts'
import { sliceSafe } from './unicode.ts'

export function calculateChunkSize(tokenCount: number, tokenLimit: number): number {
  if (tokenCount <= tokenLimit) return tokenCount
  const numChunks = Math.ceil(tokenCount / tokenLimit)
  let chunkSize = Math.floor(tokenCount / numChunks)
  const remaining = tokenCount % tokenLimit
  if (remaining > 0) chunkSize += Math.floor(remaining / numChunks)
  return chunkSize
}

const SEPARATORS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ']

function splitOnSeparator(text: string, separator: string): string[] {
  const parts = text.split(separator)
  return parts.map((p, i) => (i < parts.length - 1 ? p + separator : p)).filter((p) => p.length > 0)
}

function splitRecursive(text: string, maxTokens: number, separators: string[]): string[] {
  if (countTokens(text) <= maxTokens) return [text]
  const [separator, ...rest] = separators
  if (separator === undefined) return splitByCharacters(text, maxTokens)
  const parts = splitOnSeparator(text, separator)
  if (parts.length <= 1) return splitRecursive(text, maxTokens, rest)
  const out: string[] = []
  for (const part of parts) out.push(...splitRecursive(part, maxTokens, rest))
  return out
}

/** Last resort when no separator fits: cut by character count, never inside a surrogate pair or a placeholder token. */
function splitByCharacters(text: string, maxTokens: number): string[] {
  const out: string[] = []
  const approxChars = Math.max(1, maxTokens * 3)
  let i = 0
  while (i < text.length) {
    let end = Math.min(text.length, i + approxChars)
    const open = text.lastIndexOf(PLACEHOLDER_OPEN, end - 1)
    if (open > i && open < end && text.indexOf(PLACEHOLDER_CLOSE, open) >= end) end = open
    const piece = sliceSafe(text, i, end)
    if (piece.length === 0) break
    out.push(piece)
    i += piece.length
  }
  return out
}

function mergePieces(pieces: string[], maxTokens: number): string[] {
  const merged: string[] = []
  let current = ''
  for (const piece of pieces) {
    const candidate = current + piece
    if (current.length > 0 && countTokens(candidate) > maxTokens) {
      merged.push(current)
      current = piece
    } else {
      current = candidate
    }
  }
  if (current.length > 0) merged.push(current)
  return merged
}

export function chunkText(text: string, tokenLimit: number): Chunk[] {
  const total = countTokens(text)
  if (total <= tokenLimit) return [{ index: 0, text, tokenEstimate: total }]
  const chunkSize = calculateChunkSize(total, tokenLimit)
  const pieces = splitRecursive(text, chunkSize, SEPARATORS)
  return mergePieces(pieces, chunkSize).map((t, index) => ({
    index,
    text: t,
    tokenEstimate: countTokens(t),
  }))
}
