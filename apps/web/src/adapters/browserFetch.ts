import type { FetchPort } from '@experttranslate/core'
import { logger } from './logger'

export class CorsBlockedError extends Error {
  constructor(readonly url: string) {
    super(
      'The site refused the request from a browser (CORS). Paste the content or upload the file instead.',
    )
    this.name = 'CorsBlockedError'
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
      if (error instanceof TypeError) throw new CorsBlockedError(url)
      throw error
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ${url}`)
    const body = await res.text()
    const contentType = res.headers.get('content-type') ?? ''
    logger.debug('fetch.done', { url, bytes: body.length, contentType })
    return { body, contentType }
  },
}
