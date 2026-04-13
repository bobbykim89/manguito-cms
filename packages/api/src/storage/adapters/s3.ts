import type { StorageAdapter, UploadOptions, UploadResult } from '../types.js'

export interface S3AdapterOptions {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
}

export function createS3Adapter(_options: S3AdapterOptions): StorageAdapter {
  throw new Error('createS3Adapter: not yet implemented')
}
