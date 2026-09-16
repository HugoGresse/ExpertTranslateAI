export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }

export const parseLogLevel = (raw: string | null | undefined, fallback: LogLevel): LogLevel =>
  // The includes() check just proved `raw` is one of LOG_LEVELS.
  (LOG_LEVELS as readonly string[]).includes(raw ?? '') ? (raw as LogLevel) : fallback

/** True when a message at `level` should be emitted under `threshold`. */
export const levelEnabled = (level: LogLevel, threshold: LogLevel): boolean =>
  ORDER[level] >= ORDER[threshold]
