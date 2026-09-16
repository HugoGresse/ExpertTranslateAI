#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEngine,
  createOpenRouterLlm,
  type LlmPort,
  type LoggerPort,
  type TargetResult,
} from '@experttranslate/core'
import { createJsonStorage, TABLE_NAMES, type TableName } from './adapters/jsonStorage.ts'
import { createStderrLogger, type LogLevel, parseLogLevel } from './adapters/logger.ts'
import { createNodeFetch } from './adapters/nodeFetch.ts'
import { type CliArgs, type CommonArgs, parseCliArgs, type TranslateArgs, USAGE } from './args.ts'
import { buildJob } from './job.ts'
import { loadContexts, loadGuidelineFiles } from './materials.ts'
import { createProgressRenderer, fileNameFor } from './render.ts'

export interface CliDeps {
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
  readStdin: () => Promise<string>
  stdinIsTty: boolean
  createLlm: (apiKey: string, concurrency: number, logger: LoggerPort) => LlmPort
  now: () => number
  makeId: () => string
}

const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_USAGE = 2

const requireKey = (env: CliDeps['env']): string => {
  const key = env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new Error('Set OPENROUTER_API_KEY in the environment')
  return key
}

const dataDirOf = (args: CommonArgs, env: CliDeps['env']): string =>
  args.dataDir ?? env.ETA_DATA_DIR ?? join(homedir(), '.experttranslate')

async function readSource(args: TranslateArgs, deps: CliDeps): Promise<string> {
  if (args.input && args.input !== '-') return readFile(args.input, 'utf8')
  if (deps.stdinIsTty) throw new Error('Give a file to translate or pipe text on stdin')
  return deps.readStdin()
}

async function runTranslate(
  args: TranslateArgs & CommonArgs,
  deps: CliDeps,
  logger: LoggerPort,
): Promise<number> {
  const apiKey = requireKey(deps.env)
  const sourceText = (await readSource(args, deps)).trim()
  if (!sourceText) throw new Error('Nothing to translate: the source is empty')
  const storage = createJsonStorage(dataDirOf(args, deps.env), logger)
  const ports = {
    storage,
    fetch: createNodeFetch(logger),
    logger,
    now: deps.now,
    makeId: deps.makeId,
  }
  const contextSourceIds = await loadContexts(args.contexts, ports)
  const guidelineSetIds = [
    ...args.guidelineSetIds,
    ...(await loadGuidelineFiles(args.guidelineFiles, ports)),
  ]
  const job = buildJob(args, {
    id: deps.makeId(),
    now: deps.now(),
    sourceText,
    contextSourceIds,
    guidelineSetIds,
  })
  logger.info('job.created', {
    id: job.id,
    targets: job.targets.length,
    chars: sourceText.length,
    difficulty: job.difficulty,
    model: job.models.translatorA,
  })
  const llm = deps.createLlm(apiKey, args.concurrency, logger)
  const engine = createEngine({ llm, storage, clock: { now: deps.now }, logger })
  const renderer = createProgressRenderer(deps.stderr)
  const results: TargetResult[] = []
  let failed = 0
  for await (const event of engine.run(job)) {
    renderer.onEvent(event)
    if (event.type === 'target-done') results.push(event.result)
    if (event.type === 'target-failed') failed++
  }
  await emitResults(args, results, deps, logger)
  return failed > 0 ? EXIT_FAILED : EXIT_OK
}

async function emitResults(
  args: TranslateArgs,
  results: TargetResult[],
  deps: CliDeps,
  logger: LoggerPort,
): Promise<void> {
  if (args.json) {
    deps.stdout(`${JSON.stringify(results, null, 2)}\n`)
    return
  }
  if (args.outDir) {
    await mkdir(args.outDir, { recursive: true })
    for (const r of results) {
      const file = join(args.outDir, fileNameFor(r))
      await writeFile(file, `${r.finalText}\n`, 'utf8')
      logger.info('result.written', { file, targetKey: r.targetKey, chars: r.finalText.length })
      deps.stderr(`  wrote ${file}`)
    }
    return
  }
  for (const r of results) {
    if (results.length > 1) deps.stdout(`=== ${r.targetKey} ===\n`)
    deps.stdout(`${r.finalText}\n`)
  }
}

async function runImport(
  file: string,
  args: CliArgs,
  deps: CliDeps,
  logger: LoggerPort,
): Promise<number> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  const tables =
    typeof parsed === 'object' && parsed !== null && 'tables' in parsed
      ? (parsed as { tables: unknown }).tables
      : null
  if (typeof tables !== 'object' || tables === null)
    throw new Error(`${file} is not a web export (missing "tables")`)
  const storage = createJsonStorage(dataDirOf(args, deps.env), logger)
  let total = 0
  for (const name of TABLE_NAMES) {
    const rows = (tables as Record<TableName, unknown>)[name]
    if (!Array.isArray(rows)) continue
    const count = await storage.importTable(name, rows)
    deps.stderr(`  ${name}: ${count} rows`)
    total += count
  }
  deps.stderr(`imported ${total} rows into ${dataDirOf(args, deps.env)}`)
  return EXIT_OK
}

async function runModels(
  filter: string | null,
  deps: CliDeps,
  logger: LoggerPort,
): Promise<number> {
  const llm = deps.createLlm(requireKey(deps.env), 1, logger)
  const needle = filter?.toLowerCase() ?? ''
  const models = (await llm.models()).filter(
    (m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
  )
  for (const m of models)
    deps.stdout(
      `${m.id}\t${m.name}\t$${(m.pricing.promptUsdPerToken * 1e6).toFixed(2)}/M in, $${(m.pricing.completionUsdPerToken * 1e6).toFixed(2)}/M out\n`,
    )
  deps.stderr(`${models.length} models`)
  return EXIT_OK
}

async function runKey(deps: CliDeps, logger: LoggerPort): Promise<number> {
  const info = await deps.createLlm(requireKey(deps.env), 1, logger).keyInfo()
  deps.stdout(
    `${info.label}: used $${info.usageUsd.toFixed(4)}${info.limitUsd === null ? '' : ` of $${info.limitUsd.toFixed(2)}`}${info.isFreeTier ? ' (free tier)' : ''}\n`,
  )
  return EXIT_OK
}

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let args: CliArgs
  try {
    args = parseCliArgs(argv)
  } catch (error) {
    deps.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return EXIT_USAGE
  }
  const level: LogLevel = parseLogLevel(args.logLevel ?? deps.env.ETA_LOG_LEVEL, 'warn')
  const logger = createStderrLogger(level, (line) => deps.stderr(line))
  try {
    switch (args.command) {
      case 'help':
        deps.stdout(`${USAGE}\n`)
        return EXIT_OK
      case 'translate':
        return await runTranslate(args, deps, logger)
      case 'import':
        return await runImport(args.file, args, deps, logger)
      case 'models':
        return await runModels(args.filter, deps, logger)
      case 'key':
        return await runKey(deps, logger)
    }
  } catch (error) {
    logger.error('cli.failed', { command: args.command, error: String(error) })
    deps.stderr(`error: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_FAILED
  }
}

const readAll = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export const realDeps = (): CliDeps => ({
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(`${text}\n`),
  readStdin: readAll,
  stdinIsTty: process.stdin.isTTY === true,
  createLlm: (apiKey, concurrency, logger) =>
    createOpenRouterLlm({ apiKey, concurrency, title: 'ExpertTranslateAI CLI', logger }),
  now: () => Date.now(),
  makeId: () => crypto.randomUUID(),
})

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), realDeps()).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`fatal: ${error instanceof Error ? error.stack : String(error)}\n`)
      process.exit(EXIT_FAILED)
    },
  )
}
