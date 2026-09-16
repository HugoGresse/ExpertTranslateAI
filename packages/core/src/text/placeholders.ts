export interface ProtectedText {
  text: string
  placeholders: Map<string, string>
}

const PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g,
  /`[^`\n]+`/g,
  /https?:\/\/[^\s)>\]]+/g,
  /\{\{[^}]*\}\}/g,
  /\{[a-zA-Z_][\w.]*\}/g,
  /%\d*\$?[sdif]/g,
  /<\/?[a-zA-Z][^>]*>/g,
]

export const placeholderToken = (index: number): string => `⟦PH${index}⟧`

const TOKEN_RE = /⟦PH(\d+)⟧/g

export function protectPlaceholders(text: string): ProtectedText {
  const placeholders = new Map<string, string>()
  let counter = 0
  let out = text
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => {
      const token = placeholderToken(counter++)
      placeholders.set(token, match)
      return token
    })
  }
  return { text: out, placeholders }
}

export function restorePlaceholders(text: string, placeholders: Map<string, string>): string {
  return text.replace(TOKEN_RE, (token) => placeholders.get(token) ?? token)
}

export function listPlaceholderTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => m[0])
}

export function placeholderParity(
  source: string,
  translated: string,
): { missing: string[]; extra: string[] } {
  const src = new Set(listPlaceholderTokens(source))
  const dst = new Set(listPlaceholderTokens(translated))
  return {
    missing: [...src].filter((t) => !dst.has(t)),
    extra: [...dst].filter((t) => !src.has(t)),
  }
}
