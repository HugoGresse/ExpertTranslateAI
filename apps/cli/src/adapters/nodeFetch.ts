import type { FetchPort, LoggerPort } from '@experttranslate/core'

export function createNodeFetch(logger: LoggerPort): FetchPort {
  return {
    async text(url, opts) {
      logger.debug('fetch.start', { url })
      const response = await fetch(url, { ...(opts?.signal ? { signal: opts.signal } : {}) })
      if (!response.ok) {
        logger.warn('fetch.failed', { url, status: response.status })
        throw new Error(`HTTP ${response.status} fetching ${url}`)
      }
      const body = await response.text()
      const contentType = response.headers.get('content-type') ?? ''
      logger.debug('fetch.done', { url, status: response.status, bytes: body.length, contentType })
      return { body, contentType }
    },
  }
}
