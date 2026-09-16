import type { FetchPort } from '@experttranslate/core'
import { logger } from './logger'

export class CorsBlockedError extends Error {
  readonly url: string
  constructor(url: string) {
    super(
      'The request failed in the browser: the site may block cross-origin requests (CORS) or be unreachable. Paste the content or upload the file instead.',
    )
    this.name = 'CorsBlockedError'
    this.url = url
  }
}

export const browserFetch: FetchPort = {
  async text(url, opts) {
    logger.debug('fetch.start', { url })
    let res: Response
    try {
      res = await fetch(url, {
        ...(opts?.signal ? { signal: opts.signal } : {}),
        headers: { Accept: 'text/markdown, text/plain, */*' },
      })
    } catch (error) {
      if (error instanceof TypeError) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false)
          throw new Error('You appear to be offline.')
        throw new CorsBlockedError(url)
      }
      throw error
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`)
    const body = await res.text()
    const contentType = res.headers.get('content-type') ?? ''
    logger.debug('fetch.done', { url, bytes: body.length, contentType })
    return { body, contentType }
  },
}
