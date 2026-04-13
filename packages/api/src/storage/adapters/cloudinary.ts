import type { StorageAdapter, UploadOptions, UploadResult } from '../types.js'

export interface CloudinaryAdapterOptions {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export function createCloudinaryAdapter(_options: CloudinaryAdapterOptions): StorageAdapter {
  throw new Error('createCloudinaryAdapter: not yet implemented')
}
