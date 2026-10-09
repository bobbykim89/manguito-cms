import type { ErrorHandler } from 'hono'
import type { ErrorCode } from '@bobbykim/manguito-cms-core'

const ERROR_STATUS_MAP: Partial<Record<ErrorCode, number>> = {
  NOT_FOUND: 404,
  SLUG_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  VALIDATION_ERROR: 422,
  INVALID_SLUG_FORMAT: 422,
  SLUG_CONFLICT: 409,
  PUBLISH_VALIDATION_ERROR: 422,
  SINGLETON_ALREADY_EXISTS: 409,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_INVALID: 401,
  INSUFFICIENT_PERMISSION: 403,
  INSUFFICIENT_PRIVILEGE: 403,
  INVALID_FILTER_FIELD: 400,
  INVALID_FILTER_OPERATOR: 400,
  INVALID_SORT_FIELD: 400,
  INVALID_PAGINATION: 400,
  INVALID_INCLUDE_FIELD: 400,
  UNSUPPORTED_MIME_TYPE: 415,
  STORAGE_ERROR: 502,
  MEDIA_IN_USE: 409,
  ITEM_IN_USE: 409,
  PRESIGNED_URL_EXPIRED: 410,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

type ApiError = Error & { code?: ErrorCode }

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(err.stack ?? err.message)

  // Only an error raised deliberately, with a code the API maps to a status,
  // carries a message written for clients. Anything else (no code, or a
  // driver's code such as Postgres SQLSTATE '23503') may carry SQL, values or
  // internals: the client gets a generic message and the log keeps the rest.
  const raw = (err as ApiError).code
  const deliberate = raw !== undefined && raw !== 'INTERNAL_ERROR' && (raw as string) in ERROR_STATUS_MAP
  if (!deliberate) {
    return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
  }
  const status = ERROR_STATUS_MAP[raw] ?? 500
  return c.json({ ok: false, error: { code: raw, message: err.message } }, status as Parameters<typeof c.json>[1])
}
