import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  StorageAdapter,
  PresignedOptions,
  PresignedResult,
} from '@bobbykim/manguito-cms-core'

export type LocalAdapterOptions = {
  upload_dir?: string
}

type PendingUpload = {
  key: string
  expires_at: number
  folder: string
}

export function createLocalAdapter(
  options: LocalAdapterOptions = {}
): StorageAdapter {
  if (process.env['NODE_ENV'] === 'production') {
    console.warn(
      '⚠ Warning: Local storage adapter is not recommended for production.\n' +
        '  Files will not persist across container restarts or serverless invocations.\n' +
        '  Consider createS3Adapter() or createCloudinaryAdapter() for production.'
    )
  }

  const upload_dir = options.upload_dir ?? './uploads'
  const pending = new Map<string, PendingUpload>()

  return {
    type: 'local',

    async getPresignedUploadUrl(opts: PresignedOptions): Promise<PresignedResult> {
      const raw_ext = path.extname(opts.filename)
      const ext = raw_ext.startsWith('.') ? raw_ext.slice(1) : raw_ext
      const uuid = crypto.randomUUID()
      const key = ext ? `${opts.folder}/${uuid}.${ext}` : `${opts.folder}/${uuid}`
      const token = crypto.randomUUID()
      const expires_in = opts.expires_in ?? 3600
      const expires_at = Math.floor(Date.now() / 1000) + expires_in

      pending.set(token, { key, expires_at, folder: opts.folder })

      return {
        upload_url: `http://localhost:3000/_local_upload/${key}?token=${token}`,
        key,
        expires_at,
      }
    },

    getUrl(key: string): string {
      return `http://localhost:3000/uploads/${key}`
    },

    async upload(key: string, data: Uint8Array): Promise<void> {
      const filepath = path.join(upload_dir, key)
      await fs.mkdir(path.dirname(filepath), { recursive: true })
      await fs.writeFile(filepath, data)
    },

    async delete(key: string): Promise<void> {
      // Key may come in as 'uploads/image/uuid.jpg' when derived from URL pathname
      const normalizedKey = key.startsWith('uploads/') ? key.slice('uploads/'.length) : key
      const filepath = path.join(upload_dir, normalizedKey)
      try {
        await fs.unlink(filepath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err
        }
      }
    },

    async stat(key: string): Promise<{ size: number; content_type?: string } | null> {
      const filepath = path.join(upload_dir, key.startsWith('uploads/') ? key.slice('uploads/'.length) : key)
      try {
        const s = await fs.stat(filepath)
        return { size: s.size }
      } catch {
        return null
      }
    },
  }
}
