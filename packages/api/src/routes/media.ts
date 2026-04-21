import type { Hono } from 'hono'
import type { MediaRepository } from '@bobbykim/manguito-cms-core'

const VALID_MEDIA_TYPES = new Set(['image', 'video', 'file'])

function parsePagination(
  pageStr: string | undefined,
  perPageStr: string | undefined
): { ok: true; page: number; per_page: number } | { ok: false } {
  const page = pageStr !== undefined ? Number(pageStr) : 1
  const per_page = perPageStr !== undefined ? Number(perPageStr) : 10

  if (!Number.isInteger(page) || page < 1) return { ok: false }
  if (!Number.isInteger(per_page) || per_page < 1 || per_page > 100) return { ok: false }
  return { ok: true, page, per_page }
}

export function registerPublicMediaRoutes(app: Hono, mediaRepo: MediaRepository): void {
  app.get('/api/media', async (c) => {
    const pagination = parsePagination(c.req.query('page'), c.req.query('per_page'))
    if (!pagination.ok) {
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
    if (typeParam !== undefined && !VALID_MEDIA_TYPES.has(typeParam)) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `type must be one of: image, video, file`,
          },
        },
        422
      )
    }

    const opts: Parameters<typeof mediaRepo.findMany>[0] = {
      page: pagination.page,
      per_page: pagination.per_page,
    }
    if (typeParam !== undefined) {
      opts.type = typeParam as 'image' | 'video' | 'file'
    }

    const result = await mediaRepo.findMany(opts)

    return c.json(result)
  })

  app.get('/api/media/:id', async (c) => {
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
