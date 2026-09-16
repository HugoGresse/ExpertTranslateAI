import { type LogFields, type LoggerPort, type LogLevel, levelEnabled } from '@experttranslate/core'

export type { LogLevel } from '@experttranslate/core'
export { parseLogLevel } from '@experttranslate/core'

/** JSON lines on stderr, one object per event; the threshold comes from ETA_LOG_LEVEL. */
export function createStderrLogger(
  threshold: LogLevel,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): LoggerPort {
  const emit = (level: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void => {
    if (!levelEnabled(level, threshold)) return
    // Reserved keys win over field names so a `msg` or `level` field can never mask the event.
    write(JSON.stringify({ ...fields, time: new Date().toISOString(), level, msg }))
  }
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  }
}
