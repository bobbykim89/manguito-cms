import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

export type VercelHandlerOptions = {
  cors?: Partial<CorsConfig>
  region?: string
  max_duration?: number
}

export function createVercelHandler(
  options: VercelHandlerOptions = {}
): ServerAdapter {
  const _region = options.region ?? 'iad1'
  const _max_duration = options.max_duration ?? 10

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
    type: 'vercel',
    cors,
    getEntryPoint(): string {
      return 'vercel'
    },
  }
}
