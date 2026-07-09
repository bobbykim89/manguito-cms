import path from 'node:path'
import crypto from 'node:crypto'
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  StorageAdapter,
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
  const { bucket, region, prefix, access_key_id, secret_access_key } = options

  const client = new S3Client({
    region,
    // AWS SDK v3 (>= ~3.729) adds a CRC32 checksum to PutObject by default. For
    // presigned URLs that bakes the *empty-body* checksum into the signed URL,
    // so the browser's real upload fails the check with 403. Only checksum when
    // an operation actually requires it, which excludes presigned PUTs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    // Only override credentials when explicitly configured. Otherwise fall back
    // to the SDK's default provider chain, which resolves the Lambda/Fargate
    // execution role *including the AWS_SESSION_TOKEN that temporary credentials
    // require*. Hand-reading only AWS_ACCESS_KEY_ID/SECRET dropped the session
    // token, so presigned URLs 403'd on Lambda (works on Fargate, whose role
    // credentials don't arrive via those env vars).
    ...(access_key_id && secret_access_key
      ? { credentials: { accessKeyId: access_key_id, secretAccessKey: secret_access_key } }
      : {}),
  })

  return {
    type: 's3',

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

    async upload(key: string, data: Uint8Array, mimeType: string): Promise<void> {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: mimeType,
      })
      await client.send(command)
    },

    async delete(key: string): Promise<void> {
      const command = new DeleteObjectCommand({ Bucket: bucket, Key: key })
      await client.send(command)
    },

    async stat(key: string): Promise<{ size: number; content_type?: string } | null> {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return {
          size: head.ContentLength ?? 0,
          ...(head.ContentType !== undefined && { content_type: head.ContentType }),
        }
      } catch {
        return null
      }
    },

    getUploadOrigins(): string[] {
      return [`https://${bucket}.s3.${region}.amazonaws.com`]
    },
  }
}
