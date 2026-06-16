import type { ServerAdapter, CorsConfig } from '@bobbykim/manguito-cms-core'

export type LambdaHandlerOptions = {
  cors?: Partial<CorsConfig>
  timeout?: number
  memory?: number
}

export function createLambdaHandler(
  options: LambdaHandlerOptions = {}
): ServerAdapter {
  const _timeout = options.timeout ?? 29
  const _memory = options.memory ?? 512

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
    type: 'lambda',
    cors,
    getEntryPoint(): string {
      return 'lambda'
    },
  }
}
