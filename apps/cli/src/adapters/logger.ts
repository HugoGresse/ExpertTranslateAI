import type { LogFields, LoggerPort } from '@experttranslate/core'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

export const parseLogLevel = (raw: string | undefined, fallback: LogLevel): LogLevel =>
  raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' || raw === 'silent'
    ? raw
    : fallback

/** JSON lines on stderr, one object per event; the level comes from ETA_LOG_LEVEL. */
export function createStderrLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): LoggerPort {
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void => {
    if (ORDER[lvl] < ORDER[level]) return
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...fields }))
  }
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  }
}
