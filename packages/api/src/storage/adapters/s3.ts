import path from 'node:path'
import crypto from 'node:crypto'
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
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
  const { bucket, region, prefix } = options
  const access_key_id = options.access_key_id ?? process.env['AWS_ACCESS_KEY_ID']
  const secret_access_key = options.secret_access_key ?? process.env['AWS_SECRET_ACCESS_KEY']

  const client = new S3Client({
    region,
    ...(access_key_id && secret_access_key
      ? { credentials: { accessKeyId: access_key_id, secretAccessKey: secret_access_key } }
      : {}),
  })

  return {
    type: 's3',

    async upload(_file: File | Buffer, _options: UploadOptions): Promise<UploadResult> {
      throw new Error('createS3Adapter.upload: binary upload not supported — use presigned URL flow')
    },

    async getPresignedUploadUrl(opts: PresignedOptions): Promise<PresignedResult> {
      const raw_ext = path.extname(opts.filename)
      const ext = raw_ext.startsWith('.') ? raw_ext.slice(1) : raw_ext
      const uuid = crypto.randomUUID()
      const segment = ext ? `${uuid}.${ext}` : uuid
      const parts = [prefix, opts.folder, segment].filter(Boolean) as string[]
      const key = parts.join('/')
      const expires_in = opts.expires_in ?? 3600
      const expires_at = Math.floor(Date.now() / 1000) + expires_in

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: opts.mime_type,
      })

      const upload_url = await getSignedUrl(client, command, { expiresIn: expires_in })

      return { upload_url, key, expires_at }
    },

    getUrl(key: string): string {
      return `https://${bucket}.s3.${region}.amazonaws.com/${key}`
    },

    async delete(key: string): Promise<void> {
      const command = new DeleteObjectCommand({ Bucket: bucket, Key: key })
      await client.send(command)
    },
  }
}
