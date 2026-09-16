#!/usr/bin/env node
import { createOpenRouterLlm } from '@experttranslate/core'
import { createJsonStorage, createStderrLogger } from '@experttranslate/node'
import { configFromEnv, type ServerConfig } from '../src/config.ts'
import { createEtaServer, SERVER_VERSION } from '../src/server.ts'

function boot(config: ServerConfig): void {
  const logger = createStderrLogger(config.logLevel)
  const server = createEtaServer({
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
  server.listen(config.port, config.host, () => {
    logger.info('server.listening', {
      host: config.host,
      port: config.port,
      version: SERVER_VERSION,
      auth: Boolean(config.token),
      origins: config.allowedOrigins,
      dataDir: config.dataDir,
    })
  })
  const shutdown = (signal: string): void => {
    logger.info('server.shutdown', { signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5_000).unref()
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
