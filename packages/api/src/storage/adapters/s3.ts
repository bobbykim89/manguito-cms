import type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  PresignedOptions,
  PresignedResult,
} from '@bobbykim/manguito-cms-core'

export type S3AdapterOptions = {
  bucket: string
  region: string
  prefix?: string
  access_key_id?: string
  secret_access_key?: string
}

export function createS3Adapter(options: S3AdapterOptions): StorageAdapter {
  const _bucket = options.bucket
  const _region = options.region
  const _prefix = options.prefix
  const _access_key_id = options.access_key_id ?? process.env['AWS_ACCESS_KEY_ID']
  const _secret_access_key =
    options.secret_access_key ?? process.env['AWS_SECRET_ACCESS_KEY']

  return {
    type: 's3',

    async upload(
      _file: File | Buffer,
      _options: UploadOptions
    ): Promise<UploadResult> {
      throw new Error('createS3Adapter.upload: not yet implemented (Phase 5)')
    },

    async delete(_key: string): Promise<void> {
      throw new Error('createS3Adapter.delete: not yet implemented (Phase 5)')
    },

    getUrl(_key: string): string {
      throw new Error('createS3Adapter.getUrl: not yet implemented (Phase 5)')
    },

    async getPresignedUploadUrl(
      _options: PresignedOptions
    ): Promise<PresignedResult> {
      throw new Error(
        'createS3Adapter.getPresignedUploadUrl: not yet implemented (Phase 5)'
      )
    },
  }
}
