import type { ParseErrorCode } from './parser/loader.js'

export type ErrorCode =
  // Phase 2 — parse errors
  | ParseErrorCode

  // Phase 5 — general
  | 'NOT_FOUND'
  | 'SLUG_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR'

  // Phase 5 — validation
  | 'VALIDATION_ERROR'
  | 'INVALID_SLUG_FORMAT'
  | 'SLUG_CONFLICT'
  | 'PUBLISH_VALIDATION_ERROR'
  | 'SINGLETON_ALREADY_EXISTS'

  // Phase 5 — auth
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'INSUFFICIENT_PERMISSION'
  | 'INSUFFICIENT_PRIVILEGE'

  // Phase 5 — query
  | 'INVALID_FILTER_FIELD'
  | 'INVALID_FILTER_OPERATOR'
  | 'INVALID_SORT_FIELD'
  | 'INVALID_PAGINATION'
  | 'INVALID_INCLUDE_FIELD'

  // Phase 5 — media
  | 'UNSUPPORTED_MIME_TYPE'
  | 'STORAGE_ERROR'
  | 'MEDIA_IN_USE'
  | 'PRESIGNED_URL_EXPIRED'

  // Phase 5 — rate limiting
  | 'RATE_LIMITED'
