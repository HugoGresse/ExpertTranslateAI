/* eslint-disable no-console */
import {
  type LogFields,
  type LoggerPort,
  type LogLevel,
  levelEnabled,
  parseLogLevel,
} from '@experttranslate/core'

export type { LogLevel } from '@experttranslate/core'

const STORAGE_KEY = 'eta.logLevel'

function readLevel(): LogLevel {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  return parseLogLevel(raw, import.meta.env.DEV ? 'debug' : 'info')
}

export function setLogLevel(level: LogLevel): void {
  localStorage.setItem(STORAGE_KEY, level)
}

export function createConsoleLogger(): LoggerPort {
  const emit = (level: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields): void => {
    if (!levelEnabled(level, readLevel())) return
    const line = `[eta] ${msg}`
    if (fields) console[level](line, fields)
    else console[level](line)
  }
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  }
}

export const logger: LoggerPort = createConsoleLogger()
