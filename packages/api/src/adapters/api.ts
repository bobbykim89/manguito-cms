import type { APIAdapter, ResolvedMediaConfig } from '@bobbykim/manguito-cms-core'

export type APIAdapterOptions = {
  prefix?: string
  media?: {
    max_file_size?: number
  }
}

export function createAPIAdapter(options: APIAdapterOptions = {}): APIAdapter {
  const prefix = options.prefix ?? '/api'
  const media: ResolvedMediaConfig = {
    max_file_size: options.media?.max_file_size ?? 4 * 1024 * 1024,
  }

  return { prefix, media }
}
