import { encode } from 'gpt-tokenizer'

export function countTokens(text: string): number {
  if (text.length === 0) return 0
  return encode(text).length
}
