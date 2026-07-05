import crypto from 'node:crypto'
import type {
  StorageAdapter,
  PresignedOptions,
  PresignedResult,
} from '@bobbykim/manguito-cms-core'

export type CloudinaryAdapterOptions = {
  cloud_name?: string
  folder?: string
  access_key_id?: string
  secret_access_key?: string
}

function toCloudinaryResourceType(folder: string): string {
  if (folder === 'video') return 'video'
  if (folder === 'file') return 'raw'
  return 'image'
}

function resourceTypeFromKey(key: string): string {
  for (const part of key.split('/')) {
    if (part === 'video') return 'video'
    if (part === 'file') return 'raw'
  }
  return 'image'
}

function signParams(params: Record<string, string | number>, secret: string): string {
  const to_sign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  // Cloudinary's default signature algorithm is SHA-1 (accounts can opt into
  // SHA-256). Match the default so signed uploads/deletes verify out of the box.
  return crypto.createHash('sha1').update(to_sign + secret).digest('hex')
}

export function createCloudinaryAdapter(
  options: CloudinaryAdapterOptions = {}
): StorageAdapter {
  const cloud_name = options.cloud_name ?? process.env['CLOUDINARY_CLOUD_NAME'] ?? ''
  const folder_prefix = options.folder
  const access_key_id = options.access_key_id ?? process.env['CLOUDINARY_API_KEY'] ?? ''
  const secret_access_key =
    options.secret_access_key ?? process.env['CLOUDINARY_API_SECRET'] ?? ''

  return {
    type: 'cloudinary',

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

      // Cloudinary uploads are a signed multipart POST — the client posts these
      // fields plus the file directly to Cloudinary (never through the server).
      return {
        upload_url,
        key,
        expires_at,
        method: 'POST',
        fields: {
          public_id,
          timestamp: String(timestamp),
          signature,
          api_key: access_key_id,
        },
      }
    },

    getUrl(key: string): string {
      const resource_type = resourceTypeFromKey(key)
      return `https://res.cloudinary.com/${cloud_name}/${resource_type}/upload/${key}`
    },

    async upload(key: string, data: Uint8Array, mimeType: string): Promise<void> {
      const timestamp = Math.floor(Date.now() / 1000)
      const params_to_sign: Record<string, string | number> = { public_id: key, timestamp }
      const signature = signParams(params_to_sign, secret_access_key)
      const resource_type = resourceTypeFromKey(key)

      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), 'upload')
      form.append('public_id', key)
      form.append('timestamp', String(timestamp))
      form.append('api_key', access_key_id)
      form.append('signature', signature)

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloud_name}/${resource_type}/upload`,
        { method: 'POST', body: form }
      )

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Cloudinary upload failed: ${res.status} ${res.statusText} — ${text}`)
      }
    },

    async delete(key: string): Promise<void> {
      const timestamp = Math.floor(Date.now() / 1000)
      const params_to_sign: Record<string, string | number> = {
        public_id: key,
        timestamp,
      }
      const signature = signParams(params_to_sign, secret_access_key)

      const resource_type = resourceTypeFromKey(key)
      const endpoint = `https://api.cloudinary.com/v1_1/${cloud_name}/${resource_type}/destroy`

      const body = new URLSearchParams({
        public_id: key,
        signature,
        timestamp: String(timestamp),
        api_key: access_key_id,
      })

      const res = await fetch(endpoint, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      const json = await res.json() as { result?: string; error?: { message: string } }

      if (json.result === 'ok' || json.result === 'not found') return

      throw new Error(
        `Cloudinary delete failed: ${json.error?.message ?? json.result ?? res.statusText}`
      )
    },
  }
}
