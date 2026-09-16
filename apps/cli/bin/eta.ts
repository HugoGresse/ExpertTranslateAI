#!/usr/bin/env node
// Thin launcher: no execution guard, so it works through the npm bin symlink as well as directly.
import { main, realDeps } from '../src/cli.ts'

main(process.argv.slice(2), realDeps()).then(
  (code) => {
    // Let stdout drain (pipes are asynchronous on macOS) instead of calling process.exit.
    process.exitCode = code
  },
  (error: unknown) => {
    realDeps().fatal(error)
    process.exitCode = 1
  },
)
