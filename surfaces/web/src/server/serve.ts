import { createServer, type Server } from 'node:http'
import { handle } from './routes.js'

export interface ServeOptions {
  port?: number
  env?: NodeJS.ProcessEnv
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

      handle(req.method ?? 'GET', req.url ?? '/', body, env)
        .then((result) => {
          res.writeHead(result.status, { 'content-type': 'application/json' })
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
    server.listen(opts.port ?? 4771, '127.0.0.1', () => resolve(server))
  })
}
