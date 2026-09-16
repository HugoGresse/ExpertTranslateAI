# ExpertTranslateAI — Implementation Plan

Client-only Astro app for high-quality, multi-language text translation. No backend. All LLM calls go from the browser straight to OpenRouter with a key the user saves locally.

Sources of the design:

- `Architecture cœur.md` (this repo): multi-model, specialised roles, adaptive orchestration, disagreement detection, multidimensional scoring, back-translation, layered glossary, translation memory, router, evaluation log.
- [andrewyng/translation-agent](https://github.com/andrewyng/translation-agent): translate → reflect → improve loop, chunking with full-document context, country/region parameter, reflection axes (accuracy, fluency, style, terminology).
- [minghao-wu/transagents](https://github.com/minghao-wu/transagents): preparation stage (guidelines: glossary, summary, tone/style, audience) before execution; role separation (translator, localization specialist, proofreader, editor); trilateral collaboration (action / critique / judgment); preference-based evaluation instead of BLEU.

---

## 1. Goals and non-goals

Goals:

- Translate a text into one or more target languages in one run.
- Quality pipeline that scales effort to difficulty (1 model → full multi-agent pipeline).
- User-owned data: OpenRouter key, glossaries, translation memory, history, all in the browser.
- Transparent: show every intermediate output, cost, score and disagreement.
- Deployable as a static site (GitHub Pages, Netlify, Cloudflare Pages).
- Translation engine isolated from the UI so it can move to Node / a server later without rewrite (section 3).
- User-supplied context: an `llms.txt` URL, a Markdown URL or an uploaded `.md` file, plus explicit translation guidelines the pipeline must respect and verify.

Non-goals (v1):

- Accounts, sync, sharing.
- File formats other than plain text / Markdown (DOCX, SRT, etc. later).
- Fine-tuning or learned routing (data is collected for it, no learning in v1).

---

## 2. Stack

| Concern    | Choice                                                                  | Version (checked 2026-09-16)                                                     |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Framework  | Astro, static output (`output: 'static'`)                               | `astro ^7.3.2`                                                                   |
| Islands    | React 19 via `@astrojs/react`                                           | `react ^19.3.0`, `@astrojs/react ^6.0.5`                                         |
| Styling    | Tailwind 4 via Vite plugin (not `@astrojs/tailwind`, deprecated for v4) | `tailwindcss ^4.3.3`, `@tailwindcss/vite ^4.3.3`                                 |
| State      | nanostores (+ `@nanostores/react`, `@nanostores/persistent`)            | `nanostores ^1.5.3`, `@nanostores/react ^2.0.1`, `@nanostores/persistent ^1.3.5` |
| Local DB   | Dexie (IndexedDB) for glossary, TM, history, eval log                   | `dexie ^4.4.6`                                                                   |
| Validation | zod for LLM JSON outputs and settings import                            | `zod ^4.6.5`                                                                     |
| Tokens     | `gpt-tokenizer` (client-side estimate, for chunking + cost preview)     | `^4.0.0`                                                                         |
| Diff       | `diff` (word-level diff for disagreement + review views)                | `^9.0.0`                                                                         |
| SSE        | `eventsource-parser` for OpenRouter streaming                           | `^4.1.1`                                                                         |
| Lint/format | Biome (single tool, replaces ESLint + Prettier) | `@biomejs/biome ^2.5.14` |
| Tests      | vitest (unit), Playwright (e2e, mocked OpenRouter)                      | `vitest ^5.0.1`, `@playwright/test ^1.63.0`                                      |
| Lang | TypeScript 7 strict (native compiler); `tsc --noEmit` per package, `astro check` unsupported on TS7 | `typescript ^7.0.2` |

Rationale: Astro gives static pages, zero JS on docs/settings routes, React islands only where the app is interactive. No OpenAI SDK: raw `fetch` keeps bundle small and avoids the `dangerouslyAllowBrowser` flag.

---

## 3. Portable core (browser today, Node / server later)

Monorepo with npm workspaces:

```
packages/core     @experttranslate/core — pure TypeScript, ESM, zero DOM / zero Node-only APIs
apps/web          Astro app, imports core, provides browser adapters
```

Rules for `packages/core`:

- Only Web-standard APIs available in both browsers and Node ≥ 20: `fetch`, `AbortController`, `ReadableStream`, `TextEncoder`, `crypto.subtle`, `structuredClone`. No `window`, `localStorage`, `IndexedDB`, `fs`, `process`.
- Everything the engine needs from the outside is a **port** (interface) injected at construction:

```ts
interface LlmPort { chat(req: ChatRequest, opts: { signal?: AbortSignal }): AsyncIterable<ChatChunk>; models(): Promise<ModelInfo[]>; }
interface StoragePort { jobs: Repo<TranslationJob>; results: Repo<TargetResult>; glossary: GlossaryRepo; tm: TmRepo; evals: Repo<EvalRecord>; contexts: Repo<ContextSource>; guidelines: Repo<GuidelineSet>; prompts: PromptOverrideRepo; }
interface FetchPort { text(url: string, opts?: { signal?: AbortSignal }): Promise<{ body: string; contentType: string }>; }
interface ClockPort { now(): number; }
interface LoggerPort { debug/info/warn/error(msg: string, fields?: Record<string, unknown>): void; }
interface EventSink { emit(e: TraceEvent | ProgressEvent): void; }

function createEngine(ports: { llm: LlmPort; storage: StoragePort; fetch: FetchPort; clock: ClockPort; logger: LoggerPort; events: EventSink }): Engine;
```

- Public surface of core: `createEngine`, `engine.run(job) → AsyncIterable<ProgressEvent>` and `engine.estimate(job)`, plus pure helpers (chunking, glossary resolution, disagreement detection, scoring, prompt builders). Types exported from one `index.ts`.
- Pipeline stages are pure functions `(input, ctx) => Promise<output>`; `ctx` carries the ports. Same code runs under a fake `LlmPort` in tests, a browser adapter in the app, and later a Node adapter.
- Adapters live outside core. Browser (`apps/web/src/adapters/`): `OpenRouterBrowserLlm`, `DexieStorage`, `BrowserFetch`, `NanostoresEventSink`. Future Node (`apps/server/`, not built now): same `OpenRouterLlm` with server-held key, `SqliteStorage` or Postgres, `NodeFetch` with no CORS constraint, an HTTP/SSE endpoint exposing `engine.run`. Astro can then switch a route to SSR with `@astrojs/node`, or a standalone Hono/Fastify service can host it; the UI only changes the adapter it talks to.
- Core has its own `vitest` config and no dependency on the Astro app. Published to the workspace only (no npm publish needed).
- Serialization: every job, result and event is plain JSON (no class instances, no `Date`), so it can cross an HTTP boundary unchanged.

---

## 4. OpenRouter integration (browser-only)

### 4.1 Key acquisition

Two paths, both local:

1. **Paste key**: user pastes `sk-or-…`. Validate via `GET https://openrouter.ai/api/v1/auth/key` (returns label, limit, usage). Show credit remaining.
2. **OAuth PKCE** (recommended UX): redirect to `https://openrouter.ai/auth?callback_url=<site>/auth/callback&code_challenge=<S256>&code_challenge_method=S256`, then `POST /api/v1/auth/keys` with `{ code, code_verifier, code_challenge_method }` → `{ key }`. Works on localhost and static hosts, no server needed.

### 4.2 Key storage

- Default: `localStorage` under a single namespaced key, opt-in "remember on this device".
- Optional passphrase encryption with WebCrypto (`PBKDF2` → `AES-GCM`); key decrypted in memory for the session only.
- "Forget key" button. Key never leaves the browser except in the `Authorization` header to `openrouter.ai`.
- Security note shown in UI: anyone with access to this browser profile can use the key; set a spend limit on the OpenRouter key.

### 4.3 Client

`apps/web/src/adapters/openrouter/client.ts` (implements `LlmPort` from core):

- `chat(request, { signal })` → `POST /api/v1/chat/completions`, headers `Authorization`, `HTTP-Referer` (site URL), `X-OpenRouter-Title: ExpertTranslateAI`.
- Streaming via `stream: true` + SSE parser; `usage` read from last chunk (`usage: { include: true }`).
- Structured outputs: `response_format: { type: 'json_schema', json_schema }` for reviewer/judge/scorer; zod-validated; fallback to `json_object` + repair prompt on parse failure.
- Retry with exponential backoff on 429/5xx, respect `Retry-After`; never retry on 401/402 (show key/credits error).
- Cost: use `usage.cost` when present, else `GET /api/v1/generation?id=` lazily; cache model pricing from `GET /api/v1/models` (refreshed daily, stored in IndexedDB).
- Concurrency limiter (default 4 parallel requests) so multi-language × multi-model fan-out does not hit rate limits.
- `AbortController` per run, cancel button in UI.

### 4.4 Model catalog

- Fetch `/api/v1/models`, filter to text-in/text-out, expose: id, name, context length, prompt/completion price, supports structured output, supports streaming.
- Presets for roles (user-editable):
  - `translatorA`, `translatorB`, `translatorC` — 2–3 different families (e.g. Anthropic, OpenAI, Google, DeepSeek) so disagreements are meaningful.
  - `reviewer`, `terminologyChecker`, `judge`, `finalizer`, `scorer`, `backTranslator`, `classifier`.
  - Cheap/fast default for `classifier` and `terminologyChecker`.
- "Auto" model option = router picks per domain (section 6.6).

---

## 5. Domain model

```ts
type LanguageCode = string // BCP-47: 'fr', 'pt-BR', 'zh-Hant'
type Difficulty = 'simple' | 'normal' | 'hard' | 'critical'
type Domain = 'general' | 'legal' | 'technical' | 'marketing' | 'medical' | 'literary' | 'ui'

interface TranslationJob {
  id: string
  createdAt: number
  sourceText: string
  sourceLang: LanguageCode | 'auto'
  targets: { lang: LanguageCode; region?: string }[] // region: 'Mexico' as in translation-agent
  domain: Domain | 'auto'
  difficulty: Difficulty | 'auto'
  options: {
    tone?: string
    audience?: string
    formality?: 'formal' | 'informal' | 'auto'
    preserveFormatting: boolean
    backTranslate: boolean
    glossaryScopeIds: string[]
    contextSourceIds: string[]
    guidelineSetIds: string[]
  }
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
}

interface ContextSource {
  // llms.txt, a Markdown URL, or an uploaded .md file
  id: string
  name: string
  kind: 'llms-txt' | 'markdown-url' | 'markdown-file' | 'pasted'
  url?: string
  rawText: string // fetched / uploaded content
  contentHash: string
  fetchedAt?: number
  condensed?: { text: string; model: string; tokenEstimate: number; forHash: string } // LLM digest used when raw is too big
  scope: GlossaryScope['level'] // reuse the same hierarchy: global → language → client → project → document
  scopeId?: string
}

interface GuidelineSet {
  // rules the translation MUST respect, verified after finalize
  id: string
  name: string
  scope: GlossaryScope['level']
  scopeId?: string
  lang?: LanguageCode // optional: only applies to this target
  rules: GuidelineRule[]
  freeText?: string // long-form style guide, injected as-is (token-capped)
}
interface GuidelineRule {
  id: string
  text: string
  kind: 'must' | 'must-not' | 'prefer'
  checkable: boolean
  examples?: { good?: string; bad?: string }
}
interface GuidelineViolation {
  ruleId: string
  severity: 'minor' | 'major'
  targetSpan?: string
  explanation: string
  fix?: string
}

interface Brief {
  // TransAgents "preparation stage"
  detectedLang: LanguageCode
  domain: Domain
  difficulty: Difficulty
  summary: string
  tone: string
  audience: string
  keyTerms: { term: string; note: string }[]
  risks: string[] // idioms, ambiguity, named entities, numbers/units, placeholders
}

interface Chunk {
  index: number
  text: string
  tokenEstimate: number
}

interface Candidate {
  chunkIndex: number
  role: 'translatorA' | 'translatorB' | 'translatorC'
  model: string
  text: string
  usage: Usage
}

interface Disagreement {
  chunkIndex: number
  sourceSpan: string
  variants: Record<string, string>
  severity: 'low' | 'medium' | 'high'
}

interface Review {
  chunkIndex: number
  model: string
  issues: Issue[]
  suggestions: string[]
}
interface Issue {
  category:
    | 'accuracy'
    | 'omission'
    | 'addition'
    | 'terminology'
    | 'grammar'
    | 'fluency'
    | 'style'
    | 'consistency'
    | 'formatting'
  severity: 'minor' | 'major' | 'critical'
  sourceSpan?: string
  targetSpan?: string
  explanation: string
  fix?: string
}

interface Judgment {
  chunkIndex: number
  winner: Candidate['role'] | 'merge'
  rationale: string
  mergedText?: string
}

interface QualityScore {
  fidelity: number
  terminology: number
  grammar: number
  naturalness: number
  register: number
  consistency: number // 0–100
  overall: number
  confidence: number // confidence = agreement between models + scorer certainty
  notes: string[]
}

interface TargetResult {
  lang: LanguageCode
  brief: Brief
  chunks: Chunk[]
  candidates: Candidate[]
  disagreements: Disagreement[]
  reviews: Review[]
  terminologyReport: TermViolation[]
  guidelineReport: GuidelineViolation[]
  judgments: Judgment[]
  finalText: string
  backTranslation?: { text: string; deltas: { source: string; back: string; note: string }[] }
  score: QualityScore
  cost: { usd: number; tokensIn: number; tokensOut: number; calls: number }
  trace: TraceEvent[] // every prompt, model, latency, usage, raw output
}
```

Glossary and memory:

```ts
type GlossaryScope = {
  level: 'global' | 'language' | 'client' | 'project' | 'document'
  lang?: LanguageCode
  parentId?: string
  name: string
}
interface GlossaryEntry {
  id: string
  scopeId: string
  source: string
  target: string
  lang: LanguageCode
  kind: 'preferred' | 'forbidden' | 'doNotTranslate'
  caseSensitive: boolean
  note?: string
}
interface TmEntry {
  id: string
  sourceLang: LanguageCode
  targetLang: LanguageCode
  source: string
  target: string
  domain: Domain
  origin: 'human-correction' | 'accepted-output'
  createdAt: number
  hash: string
}
interface EvalRecord {
  jobId: string
  lang: LanguageCode
  domain: Domain
  difficulty: Difficulty
  models: Record<string, string>
  score: QualityScore
  issueCounts: Record<string, number>
  cost: number
  humanEdited: boolean
  editDistance?: number
}
```

Resolution order for glossary: document → project → client → language → global (most specific wins; forbidden always wins over preferred at any level).

---

## 6. Pipeline (per target language)

```
source
  │
  ├─ 6.0 Context intake ─────── fetch llms.txt / .md URL or read uploaded file, condense if too big, cache by hash
  ├─ 6.1 Preprocess ─────────── normalise, protect placeholders/code/URLs, chunk
  ├─ 6.2 Brief (classifier) ──── lang detect, domain, difficulty, summary, tone, key terms, risks (sees context + guidelines)
  ├─ 6.3 Glossary + TM + guidelines ── resolve scopes, exact-match TM, build constraint block for prompts
  ├─ 6.4 Translate (1–3 models, parallel per chunk, full-doc context)
  ├─ 6.5 Disagreement detection ── align candidates, diff, flag spans
  ├─ 6.6 Review / Terminology check / Guideline check (only for normal+)
  ├─ 6.7 Judge (hard+) ──────── pick or merge per chunk
  ├─ 6.8 Finalize ───────────── apply fixes, ensure glossary + guideline compliance, reassemble, restore placeholders
  ├─ 6.9 Score ──────────────── 6 dimensions + confidence
  └─ 6.10 Back-translate (critical or opt-in) ── compare to source, list deltas
```

Multiple targets run in parallel (bounded by limiter). Context intake 6.0 and brief 6.2 are shared across targets (run once).

### 6.0 Context intake (llms.txt / Markdown)

- Inputs: a URL (`https://example.com/llms.txt`, or any `.md` / `.txt` URL), an uploaded `.md`/`.txt` file, or pasted text. Stored as `ContextSource`.
- `llms.txt` handling: parse the standard structure (H1 title, blockquote summary, H2 sections with `[title](url): description` links). Keep the title, summary and link descriptions as the digest. Optionally follow the linked `.md` pages (user picks which, bounded to N pages and M tokens) since that is where product terminology and phrasing actually live.
- Fetch goes through `FetchPort`. In the browser it is a direct `fetch`; if the origin blocks CORS, the UI shows the error and offers "paste the content" or "upload the file". A future Node adapter fetches without this limit (section 3).
- Size control: token estimate on the raw text. Under the context budget (setting, default 4k tokens per source): inject as-is. Over: one cheap LLM call produces a condensed digest focused on what matters for translation (product names, feature names, domain terms, tone, audience, phrasing to keep, things not to translate). Cached in `condensed` keyed by `contentHash`, so re-runs are free until the source changes.
- Refresh: URL sources show `fetchedAt` and a "re-fetch" button; hash change invalidates the digest.
- The context is used as background knowledge (brief, translators, reviewer, judge). The brief stage also mines it for `keyTerms` and proposes glossary entries the user can accept in one click.

### 6.1 Preprocess and chunking (from translation-agent)

- Estimate tokens with `gpt-tokenizer`. `MAX_TOKENS_PER_CHUNK` default 1000 (setting).
- If under limit: single chunk. Else compute even chunk size (`ceil(total / ceil(total / max))`) and split on paragraph → sentence → word boundaries, zero overlap.
- Multi-chunk prompts include the **whole source** with the current chunk wrapped in `<TRANSLATE_THIS>` tags, exactly as translation-agent does, so context is never lost.
- Placeholder protection: `{{var}}`, `%s`, `<tags>`, URLs, inline code → replaced with `⟦PH1⟧` tokens, restored after finalize; finalizer verifies count parity.
- Markdown preserved when `preserveFormatting` is on.

### 6.2 Brief (from TransAgents preparation stage)

One cheap structured call producing `Brief`. Sees the condensed context and the guideline sets. Difficulty heuristic mixes classifier output with signals: length, domain, sentence complexity, named entities, idioms, numeric density. Users can override difficulty and domain in UI.

### 6.3 Glossary, Translation Memory and guidelines

Guidelines:

- Rule kinds: `must`, `must-not`, `prefer`, and `keep` (a term must appear verbatim in the target whenever it appears in the source; this is how "do not translate X" is expressed, since a `must-not` pattern cannot enumerate every wrong rendering).
- `GuidelineSet` follows the same scope hierarchy as glossaries (global → language → client → project → document) and the same precedence. A set can be created from a form (rule list with must / must-not / prefer) or by pasting a long-form style guide into `freeText`; an optional LLM call extracts discrete `rules` from the free text so they become checkable.
- Rules are injected into every prompt as a numbered block:

```
<GUIDELINES>
1. MUST keep the informal "tu" form in French (audience: developers).
2. MUST NOT translate product names: Hyperfluid, Bifrost, Data Dock.
3. MUST keep sentence length under 25 words for UI strings.
4. PREFER active voice.
</GUIDELINES>
```

- Guideline checker (stage 6.6) returns `GuidelineViolation[]` referencing rule ids; `must` violations are `major`, `prefer` are `minor`. Finalizer must resolve all `major` ones; unresolved ones lower the `register` and `consistency` scores and confidence.
- Precedence when guidelines and glossary conflict: glossary `forbidden` > guideline `must-not` > glossary `preferred` > guideline `must` > `prefer`. Conflicts are reported in the UI before the run.

Glossary and TM:

- Resolve active scopes for `(lang, project, document)`; merge with precedence.
- TM: exact and normalised-exact matches (case, whitespace, punctuation) on sentence segments. Exact hits are pinned: passed as "must reuse" constraints, shown as "from memory" in UI. Fuzzy TM (trigram similarity > 0.85) passed as reference only.
- Prompt injection block:

```
<GLOSSARY>
workflow → flux de travail (preferred)
deployment → déploiement (preferred)
"Kubernetes" → do not translate
"tableau de bord" → forbidden, use "dashboard"
</GLOSSARY>
```

### 6.4 Translate

Difficulty → plan (from `Architecture cœur.md`):

| Difficulty | Translators | Review | Term check      | Judge | Score | Back-translate |
| ---------- | ----------- | ------ | --------------- | ----- | ----- | -------------- |
| simple     | 1           | –      | rule-based only | –     | cheap | –              |
| normal     | 2           | 1      | LLM             | –     | yes   | –              |
| hard       | 3           | 1      | LLM             | yes   | yes   | –              |
| critical   | 3           | 2      | LLM             | yes   | yes   | yes            |

Translator prompt = translation-agent's initial prompt + TransAgents' brief (summary, tone, audience) + glossary block + region hint ("Spanish as spoken in Mexico").

**Escalation** (adaptive orchestration): even on `simple`/`normal`, if disagreement severity is high or score confidence < threshold, automatically escalate one level and rerun only the affected chunks. Escalation is visible in the trace and capped by a per-job budget (USD) set by the user.

### 6.5 Disagreement detection

Pure function, no LLM:

1. Sentence-split each candidate, align to source sentences by order (and by placeholder anchors when present).
2. Word-level diff between candidates (`diff` package). Span is a disagreement if normalised similarity < 0.7 or a glossary term differs.
3. Severity: high if a number, placeholder, named entity or glossary term differs; medium if content words differ; low if only function words/punctuation.
4. Output feeds the reviewer ("focus on these spans") and the UI heat-map.

### 6.6 Review, terminology check and guideline check (translation-agent reflect + TransAgents critique)

- Reviewer: structured `Review` per chunk on accuracy / omission / addition / terminology / grammar / fluency / style / consistency / formatting. Sees source, all candidates, disagreements, glossary, brief.
- Terminology checker: rule-based pass first (regex on glossary entries, forbidden terms, do-not-translate, placeholder parity, number/unit parity), then a small LLM pass only for inflected or reordered forms. Emits `TermViolation[]`.
- Guideline checker: one structured call per chunk with the numbered `<GUIDELINES>` block and the candidate text; returns `GuidelineViolation[]` by rule id. Rules flagged `checkable: false` (vague style advice) are skipped by the checker and only injected into prompts. Runs on `normal` and above; on `simple` only the rule-based subset (regex-able `must-not` rules such as do-not-translate names).
- Router (from `Architecture cœur.md` §10): a `domain → role → model` table, user-editable, with sensible defaults. Falls back to the global role preset.

### 6.7 Judge (TransAgents trilateral: action / critique / judgment)

Given candidates + reviews + terminology and guideline violations, judge returns per chunk: winner, or `merge` with `mergedText`, plus rationale. Judge is a different model from the translators when possible.

### 6.8 Finalize (translation-agent improve + TransAgents proofreader)

Finalizer applies the judge's choice and review fixes, enforces glossary and `must` / `must-not` guidelines (hard constraints), restores placeholders, reassembles chunks, does a final consistency pass across chunks (terminology and names uniform across the whole document, which was TransAgents' strongest point). Output is the `finalText`.

### 6.9 Score

Structured call returning `QualityScore`. Confidence combines: scorer's self-reported certainty, inter-model agreement (1 − share of high-severity disagreements), and number of unresolved major issues. Overall = weighted mean, weights per domain (legal weights fidelity + terminology higher, marketing weights naturalness + register higher).

### 6.10 Back-translation (critical or opt-in)

Translate `finalText` back to the source language with a model not used as translator; align sentences to source; LLM lists semantic deltas (loss, addition, shift). Shown side-by-side; deltas link to the target span.

---

## 7. Prompts

All prompts live in `packages/core/src/prompts/*.ts` as pure template functions with typed inputs and unit tests (snapshot). Files: `brief.ts`, `translate.ts`, `review.ts`, `terminology.ts`, `guidelines.ts` (check + extract rules from free text), `condenseContext.ts`, `judge.ts`, `finalize.ts`, `score.ts`, `backTranslate.ts`. JSON schemas for structured outputs in `packages/core/src/schemas/*.ts` (zod, exported as JSON schema for `response_format`).

Shared prompt assembly (`assembleSystem.ts`) builds every system prompt from the same ordered blocks so all roles see the same world: role instructions → `<BRIEF>` → `<CONTEXT>` (condensed context sources) → `<GUIDELINES>` → `<GLOSSARY>` → `<MEMORY>` (pinned TM matches) → task. Each block is token-capped (settings) and truncation is logged in the trace.

Users can view and override every prompt in Settings → Prompts (stored in IndexedDB, reset to default button). Prompt version is recorded in the eval log so results stay comparable.

---

## 8. Storage (IndexedDB via Dexie)

Dexie implements `StoragePort` from core. Tables: `jobs`, `results` (one per job × lang, includes trace), `glossaryScopes`, `glossaryEntries`, `tm`, `evals`, `contextSources` (raw + condensed digest), `guidelineSets`, `models` (cached catalog + pricing), `prompts` (overrides), `settings`.

- Export / import everything as one JSON file (backup, move between browsers). Key excluded by default from export.
- Storage quota indicator; trace pruning option (keep last N jobs' traces).
- Human corrections: when the user edits `finalText` in the editor and clicks "Save as correction", sentence pairs that changed are written to `tm` with `origin: 'human-correction'`, and the job's `EvalRecord` gets `humanEdited: true` + edit distance. Optionally propose new glossary entries when a single term was consistently changed.

---

## 9. UI (Astro pages, React islands)

Routes (all static):

- `/` — Translate workspace (main island).
- `/history` — past jobs, filters by lang/domain/score/cost, reopen.
- `/glossary` — scope tree (global → language → client → project → document), entry table, CSV/TBX-lite import/export.
- `/memory` — TM browser, search, delete, import/export (TMX-lite CSV).
- `/context` — context sources: add by URL (`llms.txt`, `.md`, `.txt`) or upload/paste, scope picker, preview raw vs. condensed digest, token count, re-fetch, "propose glossary terms from this source".
- `/guidelines` — guideline sets per scope: rule list editor (must / must-not / prefer, examples, checkable toggle), free-text style guide with "extract rules" button, conflict report against glossaries.
- `/insights` — evaluation dashboard from `evals`: score by model × domain × lang, cost per 1k words, issue categories, human-edit rate. Pure client charts.
- `/settings` — OpenRouter key (paste / OAuth), role → model presets, router table, difficulty thresholds, budget cap, chunk size, concurrency, prompts, export/import, danger zone.
- `/auth/callback` — PKCE code exchange, then redirect.
- `/about` — static docs, how it works, privacy statement.

Translate workspace:

- Left: source textarea (or drop `.txt`/`.md`), source language (auto), domain, difficulty (auto + override), tone/audience/formality, glossary scope pickers, context source chips (quick-add URL or file inline), guideline set chips, options (back-translate, preserve formatting), budget estimate before running (tokens × pricing × plan, including context block tokens).
- Target languages: multi-select chips with optional region per chip. Presets ("EU 5", "LATAM", custom).
- Run: streaming status per language and per stage (progress tree), cancel, cost ticker.
- Result per language (tabs): final text editor with inline diff vs. candidates, disagreement heat-map, issues panel (click → highlight span), score radar (6 axes) + confidence, terminology report, guideline compliance report (per rule: pass / violations with fix), back-translation side-by-side, trace drawer (every call: role, model, prompt, raw output, tokens, cost, latency), copy / download / "Save as correction".
- Compare view: candidates A/B/C side by side with judge rationale.

Accessibility: keyboard navigation, RTL target support, `lang` attributes on rendered text.

---

## 10. Project layout

```
package.json               npm workspaces: packages/*, apps/*
packages/core/
  src/
    index.ts               public API + types
    ports.ts               LlmPort, StoragePort, FetchPort, ClockPort, LoggerPort, EventSink
    engine.ts              createEngine, run(), estimate()
    pipeline/              plan.ts (difficulty→plan), orchestrator.ts, escalation.ts, stages/*.ts (one per stage)
    context/               llmsTxt.ts (parser), intake.ts, condense.ts
    guidelines/            resolve.ts, extract.ts, check.ts (rule-based subset), conflicts.ts
    text/                  chunk.ts, placeholders.ts, sentences.ts, align.ts, diff.ts, tokens.ts
    glossary/              resolve.ts, apply.ts, check.ts
    tm/                    match.ts, learn.ts
    scoring/               score.ts, confidence.ts, weights.ts
    prompts/               pure template fns + assembleSystem.ts
    schemas/               zod + JSON schema
    llm/                   openRouterLlm.ts (fetch-based, isomorphic: takes key + fetch impl), sse.ts, retry.ts, limiter.ts
  tests/                   vitest — chunking, placeholders, llms.txt parser, glossary/guideline resolution + conflicts, disagreement detection, scoring math, prompt snapshots, SSE parser, plan selection, escalation, full pipeline with fake LlmPort
apps/web/
  src/
    pages/                 Astro routes (thin)
    layouts/
    components/            React islands (workspace, result tabs, glossary/guideline/context editors…), each ≤ 400 lines
    adapters/              dexieStorage.ts, browserFetch.ts, browserLlm.ts (wraps core openRouterLlm with the vault key), eventSink.ts, keyVault.ts (WebCrypto), auth.ts (paste + PKCE)
    stores/                nanostores (settings, run state)
    styles/
  tests/e2e/               Playwright with OpenRouter mocked via route interception
apps/server/               (future, not in v1) Node adapters + HTTP/SSE endpoint around the same core
```

The OpenRouter HTTP client itself lives in core (`llm/openRouterLlm.ts`) because it only needs `fetch`; the browser adapter just supplies the key and referer headers. The future server reuses it unchanged with a server-held key. Pipeline stages are pure functions `(input, ctx) => Promise<output>` where `ctx` carries the ports, so unit tests use a fake `LlmPort` with canned JSON.

---

## 11. Delivery phases

**Phase 0 — Scaffold (½ day)**
npm workspaces (`packages/core`, `apps/web`), Astro + React + Tailwind 4 + TS 7 strict, vitest in both packages, Playwright, Biome, GitHub Pages deploy workflow, `/about` page. Core `ports.ts` and `createEngine` skeleton with a fake `LlmPort` test.

**Phase 1 — OpenRouter + single-model translate (1–2 days)**
Key paste + validation, PKCE flow, model catalog, isomorphic OpenRouter client in core, streaming, cost accounting, chunking with full-doc context, placeholder protection, one translator, multi-target fan-out, basic workspace UI, Dexie `StoragePort`, history. This is already a usable app.

**Phase 1b — Context + guidelines (1–2 days)**
Context sources (URL / upload / paste, `llms.txt` parser, condense + hash cache, CORS fallback UX), guideline sets (rule editor, free-text extract, scope hierarchy), `assembleSystem` prompt blocks, `/context` and `/guidelines` pages, rule-based guideline check. Placed early because it is cheap and makes even single-model output far better.

**Phase 2 — Reflection MVP from `Architecture cœur.md` (2–3 days)**
Brief stage (sees context + guidelines, proposes glossary terms), 2 translators, reviewer, LLM guideline checker, judge, finalizer, structured outputs + zod, score + confidence, result tabs incl. guideline compliance report, trace drawer, budget preview and cap.

**Phase 3 — Glossary + TM (2 days)**
Scope hierarchy, entry editor, import/export, rule-based terminology checker, prompt injection, TM exact/fuzzy match, "Save as correction" learning loop.

**Phase 4 — Adaptive orchestration (1–2 days)**
Difficulty plans, disagreement detection, escalation with budget cap, router table by domain, third translator.

**Phase 5 — Critical pipeline + insights (1–2 days)**
Back-translation with delta view, second reviewer, eval log and `/insights` dashboard, prompt overrides UI, full export/import, encrypted key vault.

**Phase 6 — Polish**
RTL, drag-and-drop files, Markdown preservation tests, PWA offline shell (app loads without network; translation obviously still needs it), i18n of the UI itself (dogfood the pipeline).

Status: phases 0–6 are implemented. Progress events now carry a `targetKey` (`lang#region`) so two targets of the same language stay separate end to end; the workspace streams each chunk of the first translator and of the finalizer; result panes switch to RTL for Arabic, Hebrew, Persian and Urdu; the source accepts dropped or picked `.txt`/`.md` files; a manifest and a same-origin service worker cache the shell for offline loading. UI i18n is deferred: the interface stays English until the pipeline is stable enough to dogfood on itself.

**Phase 7 — Server option (later, out of v1 scope)**
`apps/server`: Node adapters (`SqliteStorage` or Postgres, `NodeFetch`, server-held OpenRouter key), Hono or Astro SSR endpoint streaming `ProgressEvent`s over SSE, a `RemoteEngine` adapter in `apps/web` that talks to it instead of running core in-browser. Enables team-shared glossaries/TM, unrestricted context fetching (no CORS), and CLI/CI usage. No change to core.


Status: the first half of this phase ships as `apps/cli`: Node adapters (`JsonStorage` with one JSON file per table, `nodeFetch`, JSON-lines stderr logger), an `eta` binary that Node runs directly through built-in type stripping (core constructors use explicit fields for that), `translate` with stdin/file input and per-target output files, `models`, `key`, and `import` of the web export bundle. No core changes were needed. The second half followed: `packages/node` holds the shared Node adapters plus a storage overlay for per-request materials, `apps/server` exposes `/api/health`, `/api/models`, `/api/key` and `POST /api/jobs` (SSE stream of `ProgressEvent`s, bearer-token auth, explicit CORS allow-list, refuses to start open without opt-in), and core gained the wire protocol (`RemoteJobRequest`, `collectMaterials`) and `createRemoteEngine`, which the web app selects when Settings → Server has a URL. Materials stay in the browser and travel with each job; results and evals are mirrored into local IndexedDB so history and insights keep working. Only the UI i18n item of Phase 6 remains open.
---

## 12. Risks and mitigations

- **CORS / key exposure**: OpenRouter allows browser calls; key is user-owned with spend limit. Documented clearly in `/about` and Settings.
- **Cost blow-up on long texts × many languages × 3 models**: pre-run estimate, hard budget cap per job, escalation only on flagged chunks, cheap models for classifier/term-check.
- **Structured output not supported by some models**: capability flag from catalog; fallback to `json_object` + zod + one repair retry.
- **Omission errors (TransAgents' known weakness)**: reviewer explicitly checks omission/addition per sentence; finalizer verifies sentence-count and placeholder parity; back-translation for critical.
- **Chunk boundary inconsistency**: full-doc context in every chunk prompt + final cross-chunk consistency pass.
- **IndexedDB quota**: trace pruning, export reminder.
- **Rate limits**: concurrency limiter, backoff, `Retry-After`.
- **Context URL blocked by CORS in the browser**: detect and offer upload/paste; solved fully by the future server adapter. Never proxy through a third-party CORS service (leaks user content).
- **Huge context sources (whole docs sites via `llms.txt` links)**: page cap + token cap per source, condensed digest cached by hash, cost of the condense call shown before fetching linked pages.
- **Contradictory guidelines / glossary**: deterministic precedence rule (section 6.3) + pre-run conflict report.
- **Core accidentally depending on browser APIs**: Biome `noRestrictedGlobals` override for `packages/core` for `window`, `document`, `localStorage`, `indexedDB`; core tests run under Node so any DOM use fails CI.

---

## 13. Definition of done (v1 = phases 0–4)

- Static build deploys with no server; `npm run build` produces `dist/` only.
- Translate a 3,000-word Markdown doc into 3 languages on `normal` with 2 models, see reviews, judge rationale, score, cost, and edit the result.
- Glossary entry changes the output and shows in the terminology report.
- An `llms.txt` URL added as context changes product-term rendering; a `must-not` guideline violation is caught by the checker and fixed by the finalizer, both visible in the reports.
- A human correction is reused verbatim on the next identical sentence.
- `packages/core` builds and its tests pass under plain Node with no browser globals; the full pipeline test runs against a fake `LlmPort`.
- All pipeline stages and text utilities covered by vitest; e2e happy path green with mocked OpenRouter.
