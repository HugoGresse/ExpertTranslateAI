# ExpertTranslateAI

Client-only translation workbench. Paste a text, pick target languages, and get high-quality translations
straight from your browser through [OpenRouter](https://openrouter.ai) with a key you own. No server.

See [PLAN.md](PLAN.md) for the full design and roadmap, and `Architecture cœur.md` for the original architecture notes.

## Layout

```
packages/core   engine: chunking, prompts, OpenRouter client, pipeline (pure TypeScript, runs in browser or Node)
apps/web        Astro + React UI, browser adapters (IndexedDB storage, key vault, PKCE auth)
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

Requires Node 22.12 or newer.

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
