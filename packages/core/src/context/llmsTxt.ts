export interface LlmsTxtLink {
  title: string
  url: string
  description?: string
}

export interface LlmsTxtSection {
  title: string
  links: LlmsTxtLink[]
  text: string
}

export interface LlmsTxt {
  title: string
  summary?: string
  intro: string
  sections: LlmsTxtSection[]
}

const LINK_RE = /^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/

export function parseLlmsTxt(text: string): LlmsTxt {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const result: LlmsTxt = { title: '', intro: '', sections: [] }
  let current: LlmsTxtSection | null = null
  const introLines: string[] = []

  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line)
    if (h1 && !result.title) {
      result.title = (h1[1] ?? '').trim()
      continue
    }
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2) {
      current = { title: (h2[1] ?? '').trim(), links: [], text: '' }
      result.sections.push(current)
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote && !current && !result.summary) {
      result.summary = (quote[1] ?? '').trim()
      continue
    }
    const link = LINK_RE.exec(line)
    if (link && current) {
      const entry: LlmsTxtLink = { title: (link[1] ?? '').trim(), url: (link[2] ?? '').trim() }
      const description = link[3]?.trim()
      if (description) entry.description = description
      current.links.push(entry)
      continue
    }
    if (current) current.text += `${line}\n`
    else introLines.push(line)
  }
  result.intro = introLines.join('\n').trim()
  for (const s of result.sections) s.text = s.text.trim()
  return result
}

export function isLlmsTxt(text: string, url?: string): boolean {
  if (url && /llms(-full)?\.txt$/i.test(url)) return true
  const parsed = parseLlmsTxt(text)
  return parsed.title.length > 0 && parsed.sections.some((s) => s.links.length > 0)
}

export function digestLlmsTxt(parsed: LlmsTxt): string {
  const out: string[] = []
  if (parsed.title) out.push(`# ${parsed.title}`)
  if (parsed.summary) out.push(parsed.summary)
  if (parsed.intro) out.push(parsed.intro)
  for (const section of parsed.sections) {
    out.push(`## ${section.title}`)
    if (section.text) out.push(section.text)
    for (const link of section.links)
      out.push(link.description ? `- ${link.title}: ${link.description}` : `- ${link.title}`)
  }
  return out.join('\n')
}
