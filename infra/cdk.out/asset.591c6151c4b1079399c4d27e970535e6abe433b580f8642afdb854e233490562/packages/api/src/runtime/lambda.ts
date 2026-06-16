import { handle } from 'hono/aws-lambda'
import type { Hono } from 'hono'
import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

const DEFAULT_CORS: CorsConfig = { origin: '*' }

export function createLambdaHandler(app: Hono): ServerAdapter & { handler: ReturnType<typeof handle> } {
  return {
    type: 'lambda',
    cors: DEFAULT_CORS,
    getEntryPoint: () => 'lambda',
    handler: handle(app),
  }
}
