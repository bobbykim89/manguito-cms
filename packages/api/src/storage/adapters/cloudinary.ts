import crypto from 'node:crypto'
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

type CloudinaryPresignedResult = PresignedResult & {
  params: {
    signature: string
    timestamp: number
    api_key: string
  }
}

function toCloudinaryResourceType(folder: string): string {
  if (folder === 'video') return 'video'
  if (folder === 'file') return 'raw'
  return 'image'
}

function signParams(params: Record<string, string | number>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return crypto.createHmac('sha256', secret).update(sorted).digest('hex')
}

export function createCloudinaryAdapter(
  options: CloudinaryAdapterOptions
): StorageAdapter {
  const { cloud_name } = options
  const folder_prefix = options.folder
  const access_key_id = options.access_key_id ?? process.env['CLOUDINARY_API_KEY'] ?? ''
  const secret_access_key =
    options.secret_access_key ?? process.env['CLOUDINARY_API_SECRET'] ?? ''

  return {
    type: 'cloudinary',

    async upload(_file: File | Buffer, _options: UploadOptions): Promise<UploadResult> {
      throw new Error(
        'createCloudinaryAdapter.upload: binary upload not supported — use presigned URL flow'
      )
    },

    async getPresignedUploadUrl(opts: PresignedOptions): Promise<PresignedResult> {
      const uuid = crypto.randomUUID()
      const public_id_parts = [folder_prefix, opts.folder, uuid].filter(Boolean) as string[]
      const public_id = public_id_parts.join('/')
      const key = public_id
      const expires_in = opts.expires_in ?? 3600
      const timestamp = Math.floor(Date.now() / 1000)
      const expires_at = timestamp + expires_in

      const params_to_sign: Record<string, string | number> = {
        public_id,
        timestamp,
      }

      const signature = signParams(params_to_sign, secret_access_key)
      const resource_type = toCloudinaryResourceType(opts.folder)
      const upload_url = `https://api.cloudinary.com/v1_1/${cloud_name}/${resource_type}/upload`

      const result: CloudinaryPresignedResult = {
        upload_url,
        key,
        expires_at,
        params: {
          signature,
          timestamp,
          api_key: access_key_id,
        },
      }

      return result
    },

    getUrl(key: string): string {
      return `https://res.cloudinary.com/${cloud_name}/image/upload/${key}`
    },

    async delete(key: string): Promise<void> {
      const timestamp = Math.floor(Date.now() / 1000)
      const params_to_sign: Record<string, string | number> = {
        public_id: key,
        timestamp,
      }
      const signature = signParams(params_to_sign, secret_access_key)

      const body = new URLSearchParams({
        public_id: key,
        signature,
        timestamp: String(timestamp),
        api_key: access_key_id,
      })

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud_name}/image/destroy`,
        { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )

      if (!res.ok) {
        throw new Error(`Cloudinary delete failed: ${res.status} ${res.statusText}`)
      }
    },
  }
}
