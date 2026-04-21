import { handle } from 'hono/vercel'
import type { Hono } from 'hono'
import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

const DEFAULT_CORS: CorsConfig = { origin: '*' }

export function createVercelHandler(app: Hono): ServerAdapter & { handler: ReturnType<typeof handle> } {
  return {
    type: 'vercel',
    cors: DEFAULT_CORS,
    getEntryPoint: () => 'vercel',
    handler: handle(app),
  }
}
