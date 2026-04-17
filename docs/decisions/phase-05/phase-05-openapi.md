# Decision — OpenAPI Spec Generation

> Deferred to Phase 5 (REST API layer). Captured here from Phase 2 discussions for future reference.

---

## Library

`@hono/zod-openapi` — generates OpenAPI specs from Zod schema definitions attached to Hono route definitions. Spec is auto-generated at build time from `ParsedSchema` output. No hand-authoring.

---

## Two Specs, Different Audiences

| Spec | URL | Auth required | Covers |
| ---- | --- | ------------- | ------ |
| Public | `/api/openapi.json` | No | All `/api/*` endpoints |
| Admin | `/admin/api/openapi.json` | Yes — valid `auth_token` cookie | All `/admin/api/*` endpoints |

**Auth endpoints excluded from both specs** (`/admin/api/auth/*`) — documenting exact cookie names and token structure in a spec is an unnecessary security surface. The login/refresh/logout flow is standard and needs no documentation.

**Config endpoint excluded** (`/admin/api/config`) — internal use by admin panel only.

**Swagger UI** — excluded from v1. Spec is served as JSON only. Developers point Postman, Insomnia, or VS Code REST Client at the spec endpoint directly. Swagger UI deferred to v2 to avoid Lambda asset-serving complications.

---

## Security Scheme (Admin Spec)

```json
{
  "components": {
    "securitySchemes": {
      "cookieAuth": {
        "type": "apiKey",
        "in": "cookie",
        "name": "auth_token"
      }
    }
  }
}
```

---

## Codegen Pipeline

```
ParsedSchema registry
        ↓
fieldToZodSchema() — maps ParsedField to Zod type
        ↓
generateContentSchema() — builds full Zod object per schema type
        ↓
createRoute() (@hono/zod-openapi) — attaches schemas to route definitions
        ↓
dist/generated/openapi.ts — static file, never hand-edited
        ↓
Served at /api/openapi.json and /admin/api/openapi.json
```

---

## Field Type → Zod Type Mapping

| Field type | Zod type |
| ---------- | -------- |
| `text/plain` | `z.string()` + `.max(limit)` + `.regex(pattern)` if defined |
| `text/rich` | `z.string()` |
| `integer` | `z.number().int()` + `.min()` + `.max()` if defined |
| `float` | `z.number()` + `.min()` + `.max()` if defined |
| `boolean` | `z.boolean()` |
| `date` | `z.string().datetime()` |
| `image` / `video` / `file` | `z.object({ id, url, mime_type, alt?, file_size, width?, height?, duration? })` |
| `enum` | `z.enum([...allowed_values])` |
| `paragraph` | Nested `z.object()` — always fully resolved |
| `reference` (default) | `z.string().uuid()` |
| `reference` (with `?include=`) | Full nested `z.object()` |

---

## Shared Response Envelope

Used across all routes — defined once:

```ts
const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional()
  })
})

// success list response
const listResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: z.array(dataSchema),
    meta: z.object({
      total: z.number().int(),
      page: z.number().int(),
      per_page: z.number().int()
    })
  })

// success single item response
const itemResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.literal(true),
    data: dataSchema
  })
```

---

## Generated Route Shape Example

For `content--blog_post` with `only_one: false`:

```ts
// dist/generated/openapi.ts — never hand-edited

export const getBlogPostListRoute = createRoute({
  method: 'get',
  path: '/api/blog-post',
  tags: ['Blog Post'],
  request: {
    query: z.object({
      page: z.coerce.number().int().min(0).default(0),
      per_page: z.coerce.number().int().min(1).max(100).default(10),
      include: z.string().optional()
        .describe('Comma-separated relation field names to expand')
    })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: listResponseSchema(BlogPostSchema) } },
      description: 'List of blog posts'
    },
    400: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Invalid query parameters'
    }
  }
})

export const getBlogPostRoute = createRoute({
  method: 'get',
  path: '/api/blog-post/{slug}',
  tags: ['Blog Post'],
  request: {
    params: z.object({ slug: z.string() }),
    query: z.object({ include: z.string().optional() })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: itemResponseSchema(BlogPostSchema) } },
      description: 'Single blog post'
    },
    404: {
      content: { 'application/json': { schema: ErrorResponseSchema } },
      description: 'Blog post not found'
    }
  }
})
```

---

## Spec Assembly

```ts
// public spec — no auth
app.doc('/api/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'Manguito CMS — Public API', version: '1.0.0' },
  tags: generatedContentTypeTags
})

// admin spec — authenticated
app.use('/admin/api/openapi.json', authMiddleware)
app.doc('/admin/api/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'Manguito CMS — Admin API', version: '1.0.0' },
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'auth_token' }
    }
  }
})
```
