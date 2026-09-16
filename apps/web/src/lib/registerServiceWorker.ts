import { logger } from '../adapters/logger'

/** Registers the offline shell worker in production builds only; dev and e2e keep plain network behaviour. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).then(
    (registration) => logger.debug('sw.registered', { scope: registration.scope }),
    (error: unknown) => logger.warn('sw.registerFailed', { error: String(error) }),
  )
}
