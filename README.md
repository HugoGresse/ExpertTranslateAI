# ExpertTranslateAI

Client-only translation workbench. Paste a text, pick target languages, and get high-quality translations
straight from your browser through [OpenRouter](https://openrouter.ai) with a key you own. No server.

See [PLAN.md](PLAN.md) for the full design and roadmap, and `Architecture cœur.md` for the original architecture notes.

## Layout

```
packages/core   engine: chunking, prompts, OpenRouter client, pipeline (pure TypeScript, runs in browser or Node)
apps/web        Astro + React UI, browser adapters (IndexedDB storage, key vault, PKCE auth)
packages/node   Node adapters shared by the CLI and the server (JSON file storage, fetch, stderr logger)
apps/cli        Node front end for the same engine (JSON file storage, stdin/stdout, web export import)
apps/server     HTTP server: server-held OpenRouter key, jobs streamed over SSE, bearer-token auth
```

## Develop

```bash
npm install
npm run dev
```

Other scripts: `npm test`, `npm run lint` (Biome), `npm run lint:fix`, `npm run typecheck`, `npm run build`,
`npm run test:e2e -w apps/web`.

TypeScript 7 (native compiler) is used everywhere; `astro check` does not support it yet, so the web app is
type-checked with `tsc` after `astro sync` and `.astro` files are validated by the build.

Requires Node 22.18 or newer (the CLI runs TypeScript directly through Node's built-in type stripping).

## Command line

The CLI runs the exact same core through Node adapters, which is the proof that the engine has no browser
dependency. It needs Node 22.18 or newer and `OPENROUTER_API_KEY` in the environment.

```bash
OPENROUTER_API_KEY=sk-or-... npx eta translate README.md --to fr,es-MX --model deepseek/deepseek-v4-flash-0731 --out translated
```

Other commands: `eta models --filter claude`, `eta key`, and `eta import export.json` to load the glossary,
guidelines, context sources and translation memory exported from the web app's Settings page. Materials
and run history live in `$ETA_DATA_DIR` (default `~/.experttranslate`) as one JSON file per table. Set
`ETA_LOG_LEVEL=debug` for JSON-lines diagnostics on stderr; run `eta --help` for every flag.

## Server mode

`apps/server` runs the same engine behind an HTTP endpoint so a team can share one OpenRouter key
without putting it in every browser:

```bash
OPENROUTER_API_KEY=sk-or-... ETA_SERVER_TOKEN=change-me ETA_ALLOWED_ORIGINS=https://you.github.io npx eta-server
```

The server refuses to start without `ETA_SERVER_TOKEN` unless `ETA_ALLOW_ANONYMOUS=true` is set and listens on
`127.0.0.1:8787` by default (`ETA_HOST`, `PORT`). It enforces its own envelope on every job regardless of what
the client asks for: `ETA_MAX_BUDGET_USD` (default 5, `none` to disable), `ETA_MAX_SOURCE_CHARS` (200000),
`ETA_MAX_JOBS` running at once (4, extra requests get 429) and an optional `ETA_ALLOWED_MODELS` list. Jobs run
against an in-memory store and nothing a client sends is written to disk; set `ETA_PERSIST_JOBS=true` to keep
results in `ETA_DATA_DIR`. Condensed digests of client contexts are cached in memory by content hash so repeat
jobs never pay the condense call twice. In the web app, Settings → Server takes the URL and token; from then on
jobs are posted to `/api/jobs` with only the materials they reference (active glossary scopes, target-language
entries and memory) and progress streams back over SSE, while results still land in the browser's history. The
server URL and token are device configuration and are never exported or imported. Put the server behind HTTPS
before exposing it beyond localhost.

## Offline shell

Production builds register a service worker (`public/sw.js`, kept as plain JS because the static build has no
step to emit an un-hashed worker from TypeScript). It precaches the shell, serves hashed assets cache-first and
pages network-first with an offline fallback, so the app and your IndexedDB data open without a network.
Translation still needs OpenRouter. Dev and e2e runs never register it.

## Deploy

Pushes to `main` build the site and publish it to GitHub Pages through `.github/workflows/deploy.yaml`.
The build reads `SITE_URL` and `BASE_PATH` so the same static output works at a repository sub-path.

## Key handling

The OpenRouter key is stored in the browser's local storage on the device where you add it. It is sent only in
the `Authorization` header to `openrouter.ai`. Set a spending limit on the key from your OpenRouter dashboard,
and use "Forget key" in Settings to remove it.
