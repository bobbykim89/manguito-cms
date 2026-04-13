import type { StorageAdapter, UploadOptions, UploadResult } from '../types.js'

export interface LocalAdapterOptions {
  uploadDir: string
  baseUrl?: string
}

export function createLocalAdapter(_options: LocalAdapterOptions): StorageAdapter {
  throw new Error('createLocalAdapter: not yet implemented')
}
