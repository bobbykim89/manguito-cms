export interface UploadOptions {
  key?: string
  contentType?: string
}

export interface UploadResult {
  key: string
  url: string
}

export interface StorageAdapter {
  upload(file: File | Buffer, options: UploadOptions): Promise<UploadResult>
  delete(key: string): Promise<void>
  getUrl(key: string): string
}
