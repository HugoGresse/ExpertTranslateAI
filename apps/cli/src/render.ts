import {
  fileSafeTargetKey,
  type ProgressEvent,
  STAGE_LABELS,
  type TargetResult,
} from '@experttranslate/core'

export interface Renderer {
  onEvent(event: ProgressEvent): void
}

const fmtUsd = (usd: number): string => `$${usd.toFixed(4)}`

/** Human-readable progress on stderr; one line per stage boundary, never per token. */
export function createProgressRenderer(write: (line: string) => void): Renderer {
  return {
    onEvent(event) {
      switch (event.type) {
        case 'job-started':
          write(
            `▶ job ${event.jobId}: ${event.targets.map((t) => t.lang + (t.region ? ` (${t.region})` : '')).join(', ')}`,
          )
          return
        case 'brief-done':
          write(
            `  brief: ${event.brief.detectedLang} → domain ${event.brief.domain}, difficulty ${event.brief.difficulty}`,
          )
          return
        case 'target-started':
          write(
            `  ${event.targetKey}: ${event.chunkCount} chunk${event.chunkCount === 1 ? '' : 's'}`,
          )
          return
        case 'stage-done': {
          if (event.targetKey === '*') return
          const chunk = event.chunkIndex === null ? '' : ` #${event.chunkIndex + 1}`
          const cost = event.usage.costUsd === null ? '' : ` ${fmtUsd(event.usage.costUsd)}`
          write(`  ${event.targetKey}: ${STAGE_LABELS[event.stage]}${chunk} (${event.role})${cost}`)
          return
        }
        case 'escalated':
          write(`  ${event.targetKey}: escalating ${event.from} → ${event.to}: ${event.reason}`)
          return
        case 'target-done': {
          const score = event.result.score ? `, confidence ${event.result.score.confidence}` : ''
          write(
            `✔ ${event.targetKey}: done (${event.result.cost.calls} calls, ${fmtUsd(event.result.cost.usd)}${score})`,
          )
          return
        }
        case 'target-failed':
          write(`✖ ${event.targetKey}: ${event.error}`)
          return
        case 'job-done':
          write(
            `■ total: ${event.cost.calls} calls, ${event.cost.tokensIn} in / ${event.cost.tokensOut} out, ${fmtUsd(event.cost.usd)}`,
          )
          return
        case 'stage-started':
        case 'token':
          return
      }
    },
  }
}

export const fileNameFor = (result: TargetResult): string =>
  `${fileSafeTargetKey(result.targetKey)}.txt`
