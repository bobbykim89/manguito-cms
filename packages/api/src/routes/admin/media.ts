// Admin media routes — upload, presigned URL, update, delete
import type { Context, Hono } from 'hono'
import type { MediaRepository, StorageAdapter } from '@bobbykim/manguito-cms-core'
import { sign, verify } from 'hono/jwt'
import type { createPermissionMiddleware } from '../../middleware/permission.js'

// ─── Accepted MIME types ──────────────────────────────────────────────────────

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

const FILE_MIME_TYPES = new Set(['application/pdf'])

// ─── Pending upload token ─────────────────────────────────────────────────────
// The presigned-url request and the confirm request can land on different
// serverless instances, so pending-upload state cannot live in memory. Encode it
// in a short-lived token signed with AUTH_SECRET — stateless and tamper-proof —
// and hand it to the client as media_id; confirm verifies it.

type PendingUpload = {
  key: string
  folder: 'image' | 'video' | 'file'
  mime_type: string
}

function authSecret(): string {
  const secret = process.env['AUTH_SECRET']
  if (!secret) throw new Error('AUTH_SECRET environment variable is not set')
  return secret
}

async function signPendingUpload(data: PendingUpload, expiresAt: number): Promise<string> {
  return sign({ ...data, exp: expiresAt }, authSecret())
}

async function verifyPendingUpload(token: string): Promise<PendingUpload | null> {
  try {
    const p = await verify(token, authSecret(), 'HS256') as {
      key: string
      folder: 'image' | 'video' | 'file'
      mime_type: string
    }
    return { key: p.key, folder: p.folder, mime_type: p.mime_type }
  } catch {
    return null
  }
}


async function handleDirectUpload(
  folder: 'image' | 'video' | 'file',
  acceptedTypes: Set<string>,
  mediaRepo: MediaRepository,
  storage: StorageAdapter,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c: Context<any, any, any>,
  altRequired: boolean,
  maxFileSize: number | undefined
): Promise<Response> {
  // Direct uploads buffer the whole file in the CMS server's memory (unlike the
  // presigned flow, which uploads straight to storage). Reject oversized bodies
  // up front via Content-Length so we never buffer them — and keep max_file_size
  // under the platform payload limit on serverless (Lambda ~6 MB).
  if (maxFileSize !== undefined) {
    const contentLength = Number(c.req.header('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxFileSize) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `Upload exceeds the maximum size of ${maxFileSize} bytes`,
          },
        },
        413
      )
    }
  }

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Expected multipart/form-data' } },
      422
    )
  }

  const fileField = formData.get('file')
  if (!(fileField instanceof File)) {
    return c.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: 'file field is required' } },
      422
    )
  }

  // Defensive second check: Content-Length may be absent (chunked) or count
  // multipart overhead, so also reject on the actual decoded file size.
  if (maxFileSize !== undefined && fileField.size > maxFileSize) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds the maximum size of ${maxFileSize} bytes`,
        },
      },
      413
    )
  }

  const mimeType = fileField.type
  if (!acceptedTypes.has(mimeType)) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'UNSUPPORTED_MIME_TYPE',
          message: `MIME type '${mimeType}' is not accepted by this endpoint`,
        },
      },
      415
    )
  }

  const altValue = formData.get('alt')
  const alt = typeof altValue === 'string' && altValue.trim() !== '' ? altValue.trim() : undefined

  if (altRequired && !alt) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'alt is required for this media type',
          details: [{ field: 'alt', message: 'alt is required' }],
        },
      },
      422
    )
  }

  let presigned: Awaited<ReturnType<StorageAdapter['getPresignedUploadUrl']>>
  try {
    presigned = await storage.getPresignedUploadUrl({
      folder,
      filename: fileField.name,
      mime_type: mimeType,
    })
  } catch {
    return c.json(
      { ok: false, error: { code: 'STORAGE_ERROR', message: 'Failed to generate upload URL' } },
      502
    )
  }

  if (storage.upload) {
    try {
      const bytes = new Uint8Array(await fileField.arrayBuffer())
      await storage.upload(presigned.key, bytes, mimeType)
    } catch (err) {
      console.error('[media] storage.upload error:', err)
      return c.json(
        { ok: false, error: { code: 'STORAGE_ERROR', message: 'Storage upload failed' } },
        502
      )
    }
  }

  const url = storage.getUrl(presigned.key)
  const fileSize = fileField.size

  const item = await mediaRepo.create({
    type: folder,
    url,
    mime_type: mimeType,
    ...(alt !== undefined && { alt }),
    file_size: fileSize,
  })

  return c.json({ ok: true, data: item }, 201)
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerAdminMediaRoutes(
  app: Hono,
  mediaRepo: MediaRepository,
  storage: StorageAdapter,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  maxFileSize: number | undefined,
): void {
  // POST /admin/api/media/image
  app.post(
    '/admin/api/media/image',
    requirePermission('media:create'),
    async (c) => {
      return handleDirectUpload('image', IMAGE_MIME_TYPES, mediaRepo, storage, c, false, maxFileSize)
    }
  )

  // POST /admin/api/media/video
  app.post(
    '/admin/api/media/video',
    requirePermission('media:create'),
    async (c) => {
      return handleDirectUpload('video', VIDEO_MIME_TYPES, mediaRepo, storage, c, true, maxFileSize)
    }
  )

  // POST /admin/api/media/file
  app.post(
    '/admin/api/media/file',
    requirePermission('media:create'),
    async (c) => {
      return handleDirectUpload('file', FILE_MIME_TYPES, mediaRepo, storage, c, true, maxFileSize)
    }
  )

  // GET /admin/api/media/presigned-url
  app.get('/admin/api/media/presigned-url', requirePermission('media:create'), async (c) => {
    const type = c.req.query('type') as 'image' | 'video' | 'file' | undefined
    const filename = c.req.query('filename')
    const mimeType = c.req.query('mime_type')

    if (!type || !['image', 'video', 'file'].includes(type)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'type must be one of: image, video, file',
            details: [{ field: 'type', message: 'type is required' }],
          },
        },
        422
      )
    }

    if (!filename || filename.trim() === '') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'filename is required',
            details: [{ field: 'filename', message: 'filename is required' }],
          },
        },
        422
      )
    }

    if (!mimeType || mimeType.trim() === '') {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'mime_type is required',
            details: [{ field: 'mime_type', message: 'mime_type is required' }],
          },
        },
        422
      )
    }

    const accepted =
      type === 'image' ? IMAGE_MIME_TYPES : type === 'video' ? VIDEO_MIME_TYPES : FILE_MIME_TYPES

    if (!accepted.has(mimeType)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'UNSUPPORTED_MIME_TYPE',
            message: `MIME type '${mimeType}' is not accepted for ${type} uploads`,
          },
        },
        415
      )
    }

    let presigned: Awaited<ReturnType<StorageAdapter['getPresignedUploadUrl']>>
    try {
      presigned = await storage.getPresignedUploadUrl({
        folder: type,
        filename,
        mime_type: mimeType,
      })
    } catch {
      return c.json(
        { ok: false, error: { code: 'STORAGE_ERROR', message: 'Failed to generate upload URL' } },
        502
      )
    }

    const media_id = await signPendingUpload(
      { key: presigned.key, folder: type, mime_type: mimeType },
      presigned.expires_at,
    )

    return c.json({
      ok: true,
      data: {
        upload_url: presigned.upload_url,
        // Signed, self-contained token the client posts back to /confirm/:id.
        media_id,
        expires_at: presigned.expires_at,
        // Present for storages that need a multipart POST with signed fields
        // (Cloudinary); absent for a raw PUT (S3).
        ...(presigned.method && { method: presigned.method }),
        ...(presigned.fields && { fields: presigned.fields }),
      },
    })
  })

  // POST /admin/api/media/confirm/:id
  app.post('/admin/api/media/confirm/:id', requirePermission('media:create'), async (c) => {
    const id = c.req.param('id')

    const pending = await verifyPendingUpload(id)
    if (!pending) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'PRESIGNED_URL_EXPIRED',
            message: 'Presigned upload not found or has expired',
          },
        },
        410
      )
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const altValue = typeof body['alt'] === 'string' ? body['alt'].trim() : undefined

    const altRequired = pending.folder === 'video' || pending.folder === 'file'
    if (altRequired && !altValue) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'alt is required for video and file uploads',
            details: [{ field: 'alt', message: 'alt is required' }],
          },
        },
        422
      )
    }

    const url = storage.getUrl(pending.key)

    const item = await mediaRepo.create({
      type: pending.folder,
      url,
      mime_type: pending.mime_type,
      ...(altValue !== undefined && { alt: altValue }),
      file_size: 0,
    })

    return c.json({ ok: true, data: item }, 201)
  })

  // PATCH /admin/api/media/:id
  app.patch(
    '/admin/api/media/:id',
    requirePermission('media:edit'),
    async (c) => {
      const id = c.req.param('id')
      const existing = await mediaRepo.findOne(id)

      if (!existing) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Media item not found' } },
          404
        )
      }

      const body = (await c.req.json()) as Record<string, unknown>
      const alt = typeof body['alt'] === 'string' ? body['alt'].trim() : undefined

      const updateData: Parameters<typeof mediaRepo.update>[1] = {}
      if (alt !== undefined) updateData.alt = alt

      const updated = await mediaRepo.update(id, updateData)
      if (!updated) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Media item not found' } },
          404
        )
      }

      return c.json({ ok: true, data: updated })
    }
  )

  // DELETE /admin/api/media/:id
  app.delete(
    '/admin/api/media/:id',
    requirePermission('media:delete'),
    async (c) => {
      const id = c.req.param('id')
      const item = await mediaRepo.findOne(id)

      if (!item) {
        return c.json(
          { ok: false, error: { code: 'NOT_FOUND', message: 'Media item not found' } },
          404
        )
      }

      if (item.reference_count > 0) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'MEDIA_IN_USE',
              message: 'Cannot delete media that is referenced by content items',
            },
          },
          409
        )
      }

      // Derive storage key from URL.
      // Cloudinary delivery URLs: https://res.cloudinary.com/{cloud}/{type}/upload/{public_id}
      // Local delivery URLs:      http://localhost/uploads/{key}
      // For Cloudinary, the adapter key is the public_id — everything after "/upload/".
      // For local (and S3), the adapter key is the full path after the host.
      const pathname = new URL(item.url).pathname
      const uploadIdx = pathname.indexOf('/upload/')
      const key = uploadIdx >= 0
        ? pathname.slice(uploadIdx + '/upload/'.length)
        : pathname.replace(/^\//, '')

      try {
        await storage.delete(key)
      } catch (err) {
        console.error('[media] storage.delete error:', err)
        return c.json(
          {
            ok: false,
            error: { code: 'STORAGE_ERROR', message: 'Failed to delete file from storage' },
          },
          502
        )
      }

      await mediaRepo.delete(id)

      return c.json({ ok: true })
    }
  )

  // GET /admin/api/media
  app.get('/admin/api/media', requirePermission('media:read'), async (c) => {
    const pageStr = c.req.query('page')
    const perPageStr = c.req.query('per_page')
    const page = pageStr !== undefined ? Number(pageStr) : 1
    const per_page = perPageStr !== undefined ? Number(perPageStr) : 10

    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(per_page) ||
      per_page < 1 ||
      per_page > 100
    ) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_PAGINATION',
            message: 'page must be ≥ 1 and per_page must be between 1 and 100',
          },
        },
        400
      )
    }

    const typeParam = c.req.query('type')
    if (typeParam !== undefined && !['image', 'video', 'file'].includes(typeParam)) {
      return c.json(
        {
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'type must be one of: image, video, file' },
        },
        422
      )
    }

    const orphanedParam = c.req.query('orphaned')
    const orphaned =
      orphanedParam === 'true' ? true : orphanedParam === 'false' ? false : undefined

    const opts: Parameters<typeof mediaRepo.findMany>[0] = { page, per_page }
    if (typeParam !== undefined) opts.type = typeParam as 'image' | 'video' | 'file'
    if (orphaned !== undefined) opts.orphaned = orphaned

    const result = await mediaRepo.findMany(opts)

    return c.json(result)
  })

  // GET /admin/api/media/:id
  app.get('/admin/api/media/:id', requirePermission('media:read'), async (c) => {
    const id = c.req.param('id')
    const item = await mediaRepo.findOne(id)

    if (!item) {
      return c.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Media item not found' } },
        404
      )
    }

    return c.json({ ok: true, data: item })
  })

}
