import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

export type NodeServerOptions = {
  port?: number
  base_url?: string
  cors?: Partial<CorsConfig>
}

export function createServer(options: NodeServerOptions = {}): ServerAdapter {
  const port = options.port ?? Number(process.env['PORT'] ?? 3000)
  const _base_url = options.base_url ?? `http://localhost:${port}`

  const cors: CorsConfig = {
    origin: options.cors?.origin ?? (process.env['ALLOWED_ORIGIN'] ?? '*'),
    methods: options.cors?.methods ?? [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
    ],
    credentials: options.cors?.credentials ?? true,
  }

  return {
    type: 'node',
    cors,
    getEntryPoint(): string {
      return 'node'
    },
  }
}
