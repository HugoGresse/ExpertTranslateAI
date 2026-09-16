import type { GlossaryEntry } from '../types.ts'

export function formatGlossaryBlock(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map((e) => {
    const note = e.note ? ` (${e.note})` : ''
    if (e.kind === 'doNotTranslate')
      return `"${e.source}" → do not translate, keep exactly as is${note}`
    if (e.kind === 'forbidden') return `"${e.source}" → never render as "${e.target}"${note}`
    return `"${e.source}" → "${e.target}"${note}`
  })
  return ['<GLOSSARY>', ...lines, '</GLOSSARY>'].join('\n')
}
