import type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  PresignedOptions,
  PresignedResult,
} from '@bobbykim/manguito-cms-core'

export type LocalAdapterOptions = {
  upload_dir?: string
  max_file_size?: number
}

export function createLocalAdapter(
  options: LocalAdapterOptions = {}
): StorageAdapter {
  if (process.env['NODE_ENV'] === 'production') {
    console.warn(
      '\u26a0 Warning: Local storage adapter is not recommended for production.\n' +
        '  Uploaded files will not persist across container restarts or serverless invocations.\n' +
        '  Consider using S3 or Cloudinary for production deployments.'
    )
  }

  const _upload_dir = options.upload_dir ?? './uploads'
  const _max_file_size = options.max_file_size

  return {
    type: 'local',

    async upload(
      _file: File | Buffer,
      _options: UploadOptions
    ): Promise<UploadResult> {
      throw new Error('createLocalAdapter.upload: not yet implemented (Phase 5)')
    },

    async delete(_key: string): Promise<void> {
      throw new Error('createLocalAdapter.delete: not yet implemented (Phase 5)')
    },

    getUrl(_key: string): string {
      throw new Error('createLocalAdapter.getUrl: not yet implemented (Phase 5)')
    },

    async getPresignedUploadUrl(
      _options: PresignedOptions
    ): Promise<PresignedResult> {
      throw new Error(
        'createLocalAdapter.getPresignedUploadUrl: not yet implemented (Phase 5)'
      )
    },
  }
}
