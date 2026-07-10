#!/usr/bin/env node
import { scaffold } from './scaffold.js'
import { createPromptAdapter } from './prompt.js'

const name = process.argv[2]

scaffold(name, { prompt: createPromptAdapter() }).catch((err: unknown) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
