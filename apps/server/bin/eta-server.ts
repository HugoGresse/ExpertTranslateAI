#!/usr/bin/env node
import { createOpenRouterLlm } from '@experttranslate/core'
import { createJsonStorage, createStderrLogger } from '@experttranslate/node'
import { configFromEnv, type ServerConfig } from '../src/config.ts'
import { createEtaServer } from '../src/server.ts'
import { SERVER_VERSION } from '../src/version.ts'

function boot(config: ServerConfig): void {
  const logger = createStderrLogger(config.logLevel)
  const eta = createEtaServer({
    config,
    llm: createOpenRouterLlm({
      apiKey: config.apiKey,
      concurrency: config.concurrency,
      title: 'ExpertTranslateAI server',
      logger,
    }),
    storage: createJsonStorage(config.dataDir, logger),
    logger,
    now: () => Date.now(),
  })
  eta.server.listen(config.port, config.host, () => {
    logger.info('server.listening', {
      host: config.host,
      port: config.port,
      version: SERVER_VERSION,
      auth: Boolean(config.token),
      origins: config.allowedOrigins,
      dataDir: config.dataDir,
      persistJobs: config.persistJobs,
      maxJobs: config.maxJobs,
      maxBudgetUsd: config.maxBudgetUsd,
      maxSourceChars: config.maxSourceChars,
      allowedModels: config.allowedModels,
    })
  })
  const shutdown = (signal: string): void => {
    logger.info('server.shutdown', { signal, jobsRunning: eta.jobsRunning() })
    const forced = setTimeout(() => {
      logger.warn('server.forcedExit', {})
      process.exit(1)
    }, 10_000)
    forced.unref()
    void eta.shutdown().then(() => {
      clearTimeout(forced)
      process.exitCode = 0
    })
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

try {
  boot(configFromEnv(process.env))
} catch (error) {
  createStderrLogger('error').error('server.config', { error: String(error) })
  process.exitCode = 2
}
