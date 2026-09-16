/* eslint-disable no-console */
import type { LogFields, LoggerPort } from '@experttranslate/core'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const STORAGE_KEY = 'eta.logLevel'

function readLevel(): LogLevel {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw
  } catch {
    /* storage unavailable */
  }
  return import.meta.env.DEV ? 'debug' : 'info'
}

export function setLogLevel(level: LogLevel): void {
  localStorage.setItem(STORAGE_KEY, level)
}

export function createConsoleLogger(): LoggerPort {
  const enabled = (level: LogLevel): boolean => ORDER[level] >= ORDER[readLevel()]
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (!enabled(level)) return
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
