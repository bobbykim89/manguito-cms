# Decision — Route Generation and Repository Pattern

> Deferred to Phase 5 (REST API layer). Captured here from Phase 2 discussions for future reference.

---

## Core Architecture Decision

Routes never interact with the ORM directly. A **repository layer** sits between Hono route handlers and the ORM. This keeps the API layer ORM-agnostic and makes future DB adapter swaps (e.g. Postgres → MongoDB) non-breaking for route handlers.

```
Hono route handler
      ↓
ContentRepository interface (defined in @bobbykim/manguito-cms-core)
      ↓
DrizzleContentRepository (Postgres) or MongooseContentRepository (MongoDB)
      ↓
Database
```

---

## ContentRepository Interface

Defined in `@bobbykim/manguito-cms-core` — no ORM dependency:

```ts
interface ContentRepository<T> {
  findMany(options: FindManyOptions): Promise<PaginatedResult<T>>
  findOne(id: string): Promise<T | null>
  findBySlug(slug: string): Promise<T | null>
  create(data: CreateInput<T>): Promise<T>
  update(id: string, data: UpdateInput<T>): Promise<T | null>
  delete(id: string): Promise<void>
  findAll(options: FindAllOptions): Promise<T[]>  // bulk fetch for SSG builds
}

type FindManyOptions = {
  page?: number
  per_page?: number
  include?: string[]        // relation field names to expand
  published_only?: boolean
  filters?: Record<string, unknown>
}

type FindAllOptions = {
  include?: string[]
  published_only?: boolean
}
```

`findAll` is unauthenticated-dangerous — restrict to authenticated requests only to prevent abuse. It exists to support SSG build processes that need all content in as few requests as possible.

---

## Route Generation — Build vs Dev

**Production (`manguito build`):**
- Schemas compiled to static `dist/generated/routes.ts` and `dist/generated/repositories.ts`
- Runtime imports pre-built code — no schema parsing, fast cold starts
- Lambda cold starts benefit significantly from this

**Dev mode (`manguito dev`):**
- Schemas parsed dynamically at startup, written to `.manguito/`
- File watcher triggers incremental regeneration on schema change
- Only the affected schema's routes and repository are regenerated — not the full registry
- Hono supports hot-swapping individual route groups without server restart

```ts
// dev mode — one sub-app per schema, hot-swappable
class DevRouteManager {
  private routeGroups: Map<string, Hono>

  hotReload(schemaName: string, newSchema: ParsedSchema) {
    this.routeGroups.delete(schemaName)
    const newRouteGroup = generateRouteGroup(newSchema)
    this.routeGroups.set(schemaName, newRouteGroup)
    this.remount()
  }
}
```

---

## Dataloader Pattern

The repository must implement batch fetching to avoid N+1 query problems when resolving relations.

**The N+1 problem:** Naively fetching relations produces one query per parent row per relation field. 20 posts × 8 cards × 1 image each = 181 queries.

**Dataloader solution:** Batch all relation fetches using `WHERE id IN (...)`:

```
Query 1: fetch 20 blog posts
→ collect parent_ids: [id1...id20]

Query 2: SELECT * FROM paragraph_photo_card WHERE parent_id IN (id1...id20)
→ collect image_ids from cards

Query 3: SELECT * FROM media WHERE id IN (all image ids)

Query 4: SELECT * FROM paragraph_link_item WHERE parent_id IN (all card ids)
```

4 queries total regardless of post/card count. Query count = 1 + number of relation depth levels.

**Request-scoped cache:** Within a single request, fetched entities are cached by `table:id` key. If the same media item appears in 8 cards it is fetched once. Cache is discarded after response is sent — no stale data risk.

---

## Three Relation Resolution Strategies

| Relation type | Storage | Resolution |
| ------------- | ------- | ---------- |
| `paragraph` | `parent_id` on paragraph table | `WHERE parent_id IN (parentIds)` |
| `reference` one-to-one/many | FK column on content table | `WHERE id IN (fkValues)` |
| `reference` many-to-many | Junction table | Junction lookup + `WHERE id IN (rightIds)` |

Taxonomy and content references are **independent** — they have no `parent_id`. They are resolved by collecting the FK values from parent rows and batching a single `WHERE id IN (...)` query.

---

## API Route Structure

```
-- public (no auth)
GET  /api/content                    — list available content types
GET  /api/taxonomy                   — list available taxonomy types
GET  /api/{base_path}/{slug}         — single content item (only_one or by slug)
GET  /api/{base_path}                — list content items (only_one: false)
GET  /api/taxonomy/{type}            — list taxonomy terms
GET  /api/taxonomy/{type}/:id        — single taxonomy term

-- authenticated (/admin/api/*)
GET/POST/PUT/PATCH/DELETE mirrors of all public routes
Plus user management, media management, config endpoint
```

**Relation resolution via `?include=` parameter:**

```
GET /api/blog-post/my-post?include=blog_cards,blog_category
```

Default behavior: relation fields return IDs only. With `?include=field_name`, the full related object is returned. Paragraphs within an included paragraph are always auto-populated — no nested include syntax needed.

Media fields (`image`, `video`, `file`) are always fully resolved regardless of `?include=` — there is no useful case for returning just a media ID.

---

## Route Prefix Separation

```
/api/*          → public, no auth, published content only
/admin/api/*    → authenticated, full access including unpublished
```

Auth middleware is applied at the prefix level — never runs for public requests.

---

## Required DB Indexes (for Phase 3)

Generated automatically by DB codegen from parser output:

```sql
-- paragraph tables
CREATE INDEX idx_{table}_parent ON {table}(parent_id, parent_field, order);

-- FK columns on content tables
CREATE INDEX idx_{table}_{fk_col} ON {table}({fk_col});

-- junction tables
CREATE INDEX idx_{junction}_left ON {junction}(left_id, order);
CREATE INDEX idx_{junction}_right ON {junction}(right_id);
```

---

## SSG Build Process Consideration

SSG build processes (Nuxt, Astro, Next.js) issue burst queries at build time — potentially hundreds of content items with relations. The bulk `findAll` endpoint combined with the dataloader pattern handles this efficiently. Rate-limit `findAll` for unauthenticated requests to prevent abuse while allowing authenticated build processes to use it freely.
