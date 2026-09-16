import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createEngine,
  createOpenRouterLlm,
  importBundle,
  isExportBundle,
  type LlmPort,
  type LoggerPort,
  type TargetResult,
} from '@experttranslate/core'
import {
  createJsonStorage,
  createNodeFetch,
  createStderrLogger,
  type LogLevel,
  parseLogLevel,
} from '@experttranslate/node'
import { type CliArgs, parseCliArgs, type TranslateArgs, USAGE } from './args.ts'
import { buildJob, roleModelsFor } from './job.ts'
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
  /** Abort signal fired on SIGINT/SIGTERM so the engine can persist a cancelled job. */
  signal: AbortSignal
  /** Last-resort reporter for errors that escape `main`, on the structured channel. */
  fatal: (error: unknown) => void
}

interface Runtime {
  deps: CliDeps
  logger: LoggerPort
  dataDir: string
}

const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_USAGE = 2

const requireKey = (env: CliDeps['env']): string => {
  const key = env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new Error('Set OPENROUTER_API_KEY in the environment')
  return key
}

async function readSource(args: TranslateArgs, rt: Runtime): Promise<string> {
  if (args.input && args.input !== '-') {
    rt.logger.debug('source.read', { file: args.input })
    const text = await readFile(args.input, 'utf8')
    rt.logger.debug('source.readDone', { file: args.input, chars: text.length })
    return text
  }
  if (rt.deps.stdinIsTty) throw new Error('Give a file to translate or pipe text on stdin')
  const text = await rt.deps.readStdin()
  rt.logger.debug('source.stdin', { chars: text.length })
  return text
}

async function runTranslate(args: TranslateArgs, rt: Runtime): Promise<number> {
  const { deps, logger } = rt
  const apiKey = requireKey(deps.env)
  const sourceText = (await readSource(args, rt)).trim()
  if (!sourceText) throw new Error('Nothing to translate: the source is empty')
  const storage = createJsonStorage(rt.dataDir, logger)
  const llm = deps.createLlm(apiKey, args.concurrency, logger)
  const ports = {
    storage,
    fetch: createNodeFetch(logger),
    logger,
    now: deps.now,
    makeId: deps.makeId,
  }
  const contextSourceIds = await loadContexts(args.contexts, ports)
  const extracted = await loadGuidelineFiles(args.guidelineFiles, ports, {
    llm,
    model: roleModelsFor(args).helper,
    reasoningEffort: args.reasoning,
    signal: deps.signal,
  })
  const job = buildJob(args, {
    id: deps.makeId(),
    now: deps.now(),
    sourceText,
    contextSourceIds,
    guidelineSetIds: [...args.guidelineSetIds, ...extracted],
  })
  logger.info('job.created', {
    id: job.id,
    targets: job.targets.length,
    chars: sourceText.length,
    difficulty: job.difficulty,
    model: job.models.translatorA,
  })
  const engine = createEngine({ llm, storage, clock: { now: deps.now }, logger })
  const renderer = createProgressRenderer(deps.stderr)
  const results: TargetResult[] = []
  let failed = 0
  for await (const event of engine.run(job, { signal: deps.signal })) {
    renderer.onEvent(event)
    if (event.type === 'target-done') results.push(event.result)
    if (event.type === 'target-failed') failed++
  }
  await emitResults(args, results, rt)
  if (deps.signal.aborted) deps.stderr('cancelled')
  return failed > 0 || deps.signal.aborted ? EXIT_FAILED : EXIT_OK
}

async function emitResults(
  args: TranslateArgs,
  results: TargetResult[],
  rt: Runtime,
): Promise<void> {
  if (args.outDir) {
    await mkdir(args.outDir, { recursive: true })
    for (const r of results) {
      const file = join(args.outDir, fileNameFor(r))
      await writeFile(file, `${r.finalText}\n`, 'utf8')
      rt.logger.info('result.written', { file, targetKey: r.targetKey, chars: r.finalText.length })
      rt.deps.stderr(`  wrote ${file}`)
    }
  }
  if (args.json) {
    rt.deps.stdout(`${JSON.stringify(results, null, 2)}\n`)
    return
  }
  if (args.outDir) return
  for (const r of results) {
    if (results.length > 1) rt.deps.stdout(`=== ${r.targetKey} ===\n`)
    rt.deps.stdout(`${r.finalText}\n`)
  }
}

async function runImport(file: string, rt: Runtime): Promise<number> {
  rt.logger.debug('import.read', { file })
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (!isExportBundle(parsed)) throw new Error(`${file} is not an ExpertTranslateAI export`)
  const counts = await importBundle(createJsonStorage(rt.dataDir, rt.logger), parsed, rt.logger)
  let total = 0
  for (const [name, count] of Object.entries(counts)) {
    if (count > 0) rt.deps.stderr(`  ${name}: ${count} rows`)
    total += count
  }
  rt.deps.stderr(`imported ${total} rows into ${rt.dataDir}`)
  return EXIT_OK
}

async function runModels(filter: string | null, rt: Runtime): Promise<number> {
  const llm = rt.deps.createLlm(requireKey(rt.deps.env), 1, rt.logger)
  const needle = filter?.toLowerCase() ?? ''
  const models = (await llm.models()).filter(
    (m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
  )
  for (const m of models)
    rt.deps.stdout(
      `${m.id}\t${m.name}\t$${(m.pricing.promptUsdPerToken * 1e6).toFixed(2)}/M in, $${(m.pricing.completionUsdPerToken * 1e6).toFixed(2)}/M out\n`,
    )
  rt.deps.stderr(`${models.length} models`)
  return EXIT_OK
}

async function runKey(rt: Runtime): Promise<number> {
  const info = await rt.deps.createLlm(requireKey(rt.deps.env), 1, rt.logger).keyInfo()
  rt.deps.stdout(
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
  const rt: Runtime = {
    deps,
    logger,
    dataDir: args.dataDir ?? deps.env.ETA_DATA_DIR ?? join(homedir(), '.experttranslate'),
  }
  try {
    switch (args.command) {
      case 'help':
        deps.stdout(`${USAGE}\n`)
        return EXIT_OK
      case 'translate':
        return await runTranslate(args, rt)
      case 'import':
        return await runImport(args.file, rt)
      case 'models':
        return await runModels(args.filter, rt)
      case 'key':
        return await runKey(rt)
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

export const realDeps = (): CliDeps => {
  const controller = new AbortController()
  const abort = (signal: string): void => {
    if (!controller.signal.aborted) controller.abort(new Error(`received ${signal}`))
  }
  process.once('SIGINT', () => abort('SIGINT'))
  process.once('SIGTERM', () => abort('SIGTERM'))
  const fatalLogger = createStderrLogger('error')
  return {
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(`${text}\n`),
    readStdin: readAll,
    stdinIsTty: process.stdin.isTTY === true,
    createLlm: (apiKey, concurrency, logger) =>
      createOpenRouterLlm({ apiKey, concurrency, title: 'ExpertTranslateAI CLI', logger }),
    now: () => Date.now(),
    makeId: () => crypto.randomUUID(),
    signal: controller.signal,
    fatal: (error) =>
      fatalLogger.error('cli.fatal', {
        error: String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      }),
  }
}
