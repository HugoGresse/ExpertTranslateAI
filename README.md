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

Other scripts: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e -w apps/web`.

Requires Node 22.12 or newer.

## Deploy

Pushes to `main` build the site and publish it to GitHub Pages through `.github/workflows/deploy.yaml`.
The build reads `SITE_URL` and `BASE_PATH` so the same static output works at a repository sub-path.

## Key handling

The OpenRouter key is stored in the browser's local storage on the device where you add it. It is sent only in
the `Authorization` header to `openrouter.ai`. Set a spending limit on the key from your OpenRouter dashboard,
and use "Forget key" in Settings to remove it.
