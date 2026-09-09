import { rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { openDb, portFile, replaySpool } from '@hountybunter/core'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join, normalize, resolve, sep } from 'node:path'
import { handle } from './routes.js'

export interface ServeOptions {
  port?: number
  env?: NodeJS.ProcessEnv
  /** Where the built client lives. Absent or unbuilt is reported, not guessed at. */
  clientDir?: string
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

function contentType(path: string): string {
  const dot = path.lastIndexOf('.')
  return (dot < 0 ? undefined : TYPES[path.slice(dot)]) ?? 'application/octet-stream'
}

async function serveStatic(
  res: ServerResponse,
  clientDir: string | undefined,
  urlPath: string,
): Promise<void> {
  if (!clientDir) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The client is not built. Run `npm run build:web`.')
    return
  }

  const root = resolve(clientDir)
  // normalize collapses `..` before it can escape; the prefix check is the
  // second lock, because a served file must never come from outside the build.
  const requested = normalize(urlPath === '/' ? '/index.html' : urlPath)
  const file = resolve(join(root, requested))
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('outside the client directory')
    return
  }

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': contentType(file) })
    res.end(body)
  } catch {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('The client is not built. Run `npm run build:web`.')
  }
}

/**
 * The only file that knows node:http exists. It holds no routing logic, so the
 * route table stays testable without a socket.
 *
 * Binds 127.0.0.1 explicitly: there is no auth, by design (spec §2), which is
 * only safe while the server is unreachable from the network.
 */
export function serve(opts: ServeOptions = {}): Promise<Server> {
  const env = opts.env ?? process.env

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      let body: unknown = null
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'body was not valid JSON' }))
          return
        }
      }

      const url = req.url ?? '/'
      // `/hook` is an endpoint, not a page. Leaving it to the static branch made
      // it answer 503, and curl treats an HTTP error as success — so events
      // vanished without the hook ever noticing.
      if (!url.startsWith('/api/') && !url.startsWith('/hook')) {
        void serveStatic(res, opts.clientDir, url.split('?')[0]!)
        return
      }

      // Headers reach the routes for one reason: a reconnecting EventSource
      // reports in Last-Event-ID how much of the stream it already holds.
      handle(req.method ?? 'GET', url, body, env, undefined, req.headers)
        .then((result) => {
          if (result.stream) {
            res.writeHead(result.status, result.headers)
            // Flush headers now: a terminal that only appears once the first
            // byte of output arrives looks like it failed to start.
            res.flushHeaders()
            const unsubscribe = result.stream(
              (chunk) => res.write(chunk),
              () => res.end(),
            )
            // The agent keeps producing after the tab is gone. Without this the
            // writes pile into a closed socket for as long as the hunt lives.
            res.on('close', unsubscribe)
            return
          }
          if (result.status === 204) {
            res.writeHead(204)
            res.end()
            return
          }
          res.writeHead(result.status, { 'content-type': 'application/json', ...result.headers })
          res.end(JSON.stringify(result.body))
        })
        .catch((error: unknown) => {
          // A handler throwing must not take the server down with it.
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(error) }))
        })
    })
  })

  return new Promise((resolve) => {
    server.listen(opts.port ?? 4771, '127.0.0.1', () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : opts.port

      // Drain whatever arrived while nothing was listening, before announcing
      // the port — otherwise the first live event can land ahead of older ones.
      const db = openDb(env)
      void replaySpool(db, env)
        .catch(() => undefined)
        .then(() => {
          db.close()
          // Publish the port actually bound, so a hook never has one hardcoded
          // and a conflict never means editing the user's settings.
          return writeFile(portFile(env), String(bound), 'utf8')
        })
        .then(() => resolve(server))
    })

    // A file left behind would point a hook at a server that is gone, which
    // turns every later hook into a timeout the agent's session pays for.
    // Synchronous on purpose: the file must be gone by the time close()
    // reports done, or a caller that restarts immediately races its own stale file.
    server.on('close', () => {
      rmSync(portFile(env), { force: true })
    })
  })
}
