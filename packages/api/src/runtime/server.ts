import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

const DEFAULT_CORS: CorsConfig = { origin: '*' }

export function createServer(app: Hono, options?: { port?: number }): ServerAdapter {
  const port = options?.port ?? Number(process.env['PORT'] ?? 3000)

  serve({ fetch: app.fetch, port }, (info: { port: number }) => {
    console.log(`Server listening on http://localhost:${info.port}`)
  })

  return {
    type: 'node',
    cors: DEFAULT_CORS,
    getEntryPoint: () => 'node',
  }
}
