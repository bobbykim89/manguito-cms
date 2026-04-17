import type {
  StorageAdapter,
  UploadOptions,
  UploadResult,
  PresignedOptions,
  PresignedResult,
} from '@bobbykim/manguito-cms-core'

export type CloudinaryAdapterOptions = {
  cloud_name: string
  folder?: string
  access_key_id?: string
  secret_access_key?: string
}

export function createCloudinaryAdapter(
  options: CloudinaryAdapterOptions
): StorageAdapter {
  const _cloud_name = options.cloud_name
  const _folder = options.folder
  const _access_key_id =
    options.access_key_id ?? process.env['CLOUDINARY_API_KEY']
  const _secret_access_key =
    options.secret_access_key ?? process.env['CLOUDINARY_API_SECRET']

  return {
    type: 'cloudinary',

    async upload(
      _file: File | Buffer,
      _options: UploadOptions
    ): Promise<UploadResult> {
      throw new Error(
        'createCloudinaryAdapter.upload: not yet implemented (Phase 5)'
      )
    },

    async delete(_key: string): Promise<void> {
      throw new Error(
        'createCloudinaryAdapter.delete: not yet implemented (Phase 5)'
      )
    },

    getUrl(_key: string): string {
      throw new Error(
        'createCloudinaryAdapter.getUrl: not yet implemented (Phase 5)'
      )
    },

    async getPresignedUploadUrl(
      _options: PresignedOptions
    ): Promise<PresignedResult> {
      throw new Error(
        'createCloudinaryAdapter.getPresignedUploadUrl: not yet implemented (Phase 5)'
      )
    },
  }
}
