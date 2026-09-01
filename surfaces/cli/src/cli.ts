#!/usr/bin/env node
import { runCli } from './bin.js'

const code = await runCli(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.cwd(),
})

// Set the code rather than exiting on it. `hb web` returns as soon as the
// server is listening, and process.exit would kill the server it just started;
// Node ends on its own once nothing is left holding the loop open.
process.exitCode = code
