# Decision — Pagination

> Defines the pagination strategy, query param shape, and response envelope for all list endpoints.

---

## Strategy

**Page-based pagination only.** Cursor-based pagination is deferred to v2.

Page numbers are **1-indexed** — the first page is `page=1`. This matches human expectation and makes `has_prev: false` on page 1 read naturally.

---

## Query Params

```
GET /api/blog-post?page=1&per_page=10
```

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | integer | `1` | min: `1` |
| `per_page` | integer | `10` | min: `1`, max: `100` |

Returns `400 INVALID_PAGINATION` if either param is out of range.

---

## Response Envelope

All list endpoints return this shape:

```ts
type PaginatedResult<T> = {
  ok: true
  data: T[]
  meta: {
    total: number        // total items matching the query
    page: number         // current page, 1-indexed
    per_page: number     // items per page
    total_pages: number  // Math.ceil(total / per_page)
    has_next: boolean    // page < total_pages
    has_prev: boolean    // page > 1
  }
}
```

Example response:

```json
{
  "ok": true,
  "data": [...],
  "meta": {
    "total": 47,
    "page": 2,
    "per_page": 10,
    "total_pages": 5,
    "has_next": true,
    "has_prev": true
  }
}
```

---

## Repository Translation

The repository receives 1-indexed `page` and converts to SQL `OFFSET` internally:

```ts
const offset = (page - 1) * per_page
// page=1 → OFFSET 0
// page=2 → OFFSET 10 (with per_page=10)
// page=3 → OFFSET 20
```

This conversion is entirely inside `DrizzleContentRepository` — invisible to API consumers and route handlers.

---

## Note on OpenAPI Spec

The OpenAPI spec captured in `phase-05-openapi.md` shows `page min: 0` — this is incorrect. The correct minimum is `1`. Update the generated route shape accordingly:

```ts
page: z.coerce.number().int().min(1).default(1),  // was min(0).default(0)
```
