export interface SystemBlocks {
  role: string[]
  brief?: string
  context?: string
  guidelines?: string
  glossary?: string
  memory?: string
  task?: string[]
}

export function assembleSystem(blocks: SystemBlocks): string {
  const parts: string[] = [blocks.role.join('\n')]
  const ordered: Array<[string | undefined, string]> = [
    [blocks.brief, 'Background brief for this document:'],
    [
      blocks.context,
      'Reference material about the product and domain. Use it to pick terminology and phrasing; do not translate it:',
    ],
    [blocks.guidelines, 'Rules you must follow. MUST and MUST NOT rules are hard constraints:'],
    [
      blocks.glossary,
      'Glossary. Preferred renderings are mandatory, forbidden renderings must never appear:',
    ],
    [
      blocks.memory,
      'Previously approved translations. Reuse them verbatim when the source matches:',
    ],
  ]
  for (const [block, intro] of ordered) {
    if (block?.trim()) parts.push(`${intro}\n${block.trim()}`)
  }
  if (blocks.task && blocks.task.length > 0) parts.push(blocks.task.join('\n'))
  return parts.join('\n\n')
}
