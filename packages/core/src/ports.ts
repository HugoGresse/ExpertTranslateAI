import type {
  ChatChunk,
  ChatRequest,
  ContextSource,
  GuidelineSet,
  KeyInfo,
  ModelInfo,
  ProgressEvent,
  TargetResult,
  TranslationJob,
} from './types.ts'

export interface LlmPort {
  chat(req: ChatRequest, opts?: { signal?: AbortSignal }): AsyncIterable<ChatChunk>
  models(): Promise<ModelInfo[]>
  keyInfo(): Promise<KeyInfo>
}

export interface Repo<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  put(item: T): Promise<void>
  list(): Promise<T[]>
  delete(id: string): Promise<void>
}

export interface ResultRepo {
  get(jobId: string, lang: string): Promise<TargetResult | undefined>
  put(result: TargetResult): Promise<void>
  listByJob(jobId: string): Promise<TargetResult[]>
  deleteByJob(jobId: string): Promise<void>
}

export interface StoragePort {
  jobs: Repo<TranslationJob>
  results: ResultRepo
  contexts: Repo<ContextSource>
  guidelines: Repo<GuidelineSet>
}

export interface FetchPort {
  text(url: string, opts?: { signal?: AbortSignal }): Promise<{ body: string; contentType: string }>
}

export interface ClockPort {
  now(): number
}

export type LogFields = Record<string, unknown>

export interface LoggerPort {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
}

export interface EventSink {
  emit(event: ProgressEvent): void
}

export interface EnginePorts {
  llm: LlmPort
  storage: StoragePort
  clock: ClockPort
  logger: LoggerPort
}

export const noopLogger: LoggerPort = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export const systemClock: ClockPort = { now: () => Date.now() }
