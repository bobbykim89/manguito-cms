# Decision — API Error Code Catalog

> Defines all HTTP API error codes for Phase 5 endpoints. Extends the internal `ErrorCode` enum defined in `@bobbykim/manguito-cms-core`.

---

## Response Envelope

All error responses use the standard envelope:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "details": [...]  // optional — field-level errors, additional context
  }
}
```

HTTP status codes follow convention in addition to the envelope — they are not replaced by it.

---

## Class 1 — General Request Errors

Applies to all endpoints.

| Code | HTTP | Trigger |
|------|------|---------|
| `NOT_FOUND` | 404 | Resource does not exist |
| `SLUG_NOT_FOUND` | 404 | `findBySlug` — no item with that slug exists. More specific than `NOT_FOUND` — allows frontends to distinguish "wrong URL" from "server error" |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method for the route |
| `INTERNAL_ERROR` | 500 | Unhandled server error |

---

## Class 2 — Validation Errors

Triggered on `POST`, `PATCH` when request body fails validation.

| Code | HTTP | Trigger |
|------|------|---------|
| `VALIDATION_ERROR` | 422 | One or more required fields missing or invalid format. `details` contains field-level errors |
| `INVALID_SLUG_FORMAT` | 422 | Slug contains invalid characters — must be lowercase alphanumeric and hyphens only |
| `SLUG_CONFLICT` | 409 | Slug already exists on another item of the same content type |
| `PUBLISH_VALIDATION_ERROR` | 422 | `published: true` set in PATCH but required fields are empty. `details` contains which fields failed |
| `SINGLETON_ALREADY_EXISTS` | 409 | Attempted `POST` to create a second instance of an `only_one: true` content type |

---

## Class 3 — Auth Errors

Triggered on all `/admin/api/*` endpoints.

| Code | HTTP | Trigger |
|------|------|---------|
| `UNAUTHORIZED` | 401 | No auth token present |
| `TOKEN_EXPIRED` | 401 | Auth token expired — client should attempt refresh |
| `TOKEN_INVALID` | 401 | Auth token signature invalid or tampered |
| `INSUFFICIENT_PERMISSION` | 403 | Valid token but role lacks required permission (e.g. `content:publish`) |
| `INSUFFICIENT_PRIVILEGE` | 403 | Acting user's hierarchy level too low for the operation |

---

## Class 4 — Query Errors

Triggered on list endpoints with invalid query params.

| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_FILTER_FIELD` | 400 | `filter[field]` references a field that doesn't exist on the schema |
| `INVALID_FILTER_OPERATOR` | 400 | Operator not supported for that field type (e.g. `gt` on a boolean) |
| `INVALID_SORT_FIELD` | 400 | `sort_by` references a non-sortable field |
| `INVALID_PAGINATION` | 400 | `page` or `per_page` out of allowed range |
| `INVALID_INCLUDE_FIELD` | 400 | `include` references a field that doesn't exist or isn't a relation |

---

## Class 5 — Media Errors

Triggered on media upload and management endpoints.

| Code | HTTP | Trigger |
|------|------|---------|
| `UNSUPPORTED_MIME_TYPE` | 415 | Uploaded file type not accepted by the endpoint |
| `STORAGE_ERROR` | 502 | Storage adapter failed — S3 unreachable, Cloudinary error, local write failed |
| `MEDIA_IN_USE` | 409 | Attempted to delete media still referenced by content items |
| `PRESIGNED_URL_EXPIRED` | 410 | Confirm step called after presigned URL window expired |

---

## Class 6 — Rate Limiting

Triggered on bulk fetch endpoint for unauthenticated consumers.

| Code | HTTP | Trigger |
|------|------|---------|
| `RATE_LIMITED` | 429 | `findAll` bulk endpoint called too frequently from the same IP |

Rate limited responses include standard headers:

```
Retry-After: 43
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714521600
```

---

## ErrorCode Enum Addition

Add all Phase 5 codes to the `ErrorCode` enum in `@bobbykim/manguito-cms-core`:

```ts
type ErrorCode =
  // Phase 2 parse errors (existing) ...

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
```
