#!/usr/bin/env node
import { runCli } from './bin.js'

const code = await runCli(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.cwd(),
})
process.exit(code)
