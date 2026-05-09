# Decision — Filtering, Sorting, and Relation Inclusion

> Defines the query param syntax for filtering, sorting, and relation population on list and single item endpoints.

---

## Filtering

### Syntax

Bracket notation throughout:

```
GET /api/blog-post?filter[status]=published
```

### Supported Operators

| Operator | Syntax | Applies to |
|----------|--------|------------|
| Equality | `?filter[field]=value` | All filterable fields |
| Greater than | `?filter[field][gt]=value` | `integer`, `float`, `date` |
| Greater than or equal | `?filter[field][gte]=value` | `integer`, `float`, `date` |
| Less than | `?filter[field][lt]=value` | `integer`, `float`, `date` |
| Less than or equal | `?filter[field][lte]=value` | `integer`, `float`, `date` |

Text search (`contains`) is deferred to v2 — full text search requires dedicated indexing beyond a simple SQL `LIKE` query.

### Multi-Value (OR within same field)

Multiple values for the same field act as `OR`:

```
GET /api/blog-post?filter[status]=draft&filter[status]=review
→ WHERE status IN ('draft', 'review')
```

### Multiple Fields (AND across fields)

Different fields act as `AND`:

```
GET /api/blog-post?filter[status]=published&filter[category]=news
→ WHERE status = 'published' AND category = 'news'
```

### Error Codes

| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_FILTER_FIELD` | 400 | `filter[field]` references a field that doesn't exist on the schema |
| `INVALID_FILTER_OPERATOR` | 400 | Operator not supported for that field type (e.g. `gt` on a boolean) |

---

## Sorting

### Syntax

```
GET /api/blog-post?sort_by=created_at&sort_order=desc
```

| Param | Default | Options |
|-------|---------|---------|
| `sort_by` | `created_at` | See sortable fields below |
| `sort_order` | `asc` | `asc`, `desc` |

`sort_order` uses `sort_order` not `order` to avoid collision with the `order` column on paragraph tables.

### Sortable Fields

Only indexed system fields are sortable in v1. Sorting by arbitrary content fields is not supported — no index guarantee, unpredictable query performance.

| Field | Sortable |
|-------|----------|
| `title` | ✓ |
| `created_at` | ✓ |
| `updated_at` | ✓ |
| `slug` | ✗ |
| `published` | ✗ |
| Any custom field | ✗ |

Returns `400 INVALID_SORT_FIELD` if `sort_by` references a non-sortable field.

---

## Relation Inclusion (`?include=`)

### Syntax

Comma-separated relation field names:

```
GET /api/blog-post?include=photo_cards,blog_category
GET /api/blog-post/my-post?include=photo_cards,blog_category
```

`?include=` works on **both list and single item endpoints**. The dataloader pattern handles batching efficiently on list endpoints — no significant performance concern.

### Default Behavior (without `?include=`)

Relation fields return IDs only:

```json
{
  "photo_cards": ["uuid-1", "uuid-2"],
  "blog_category": "uuid-3"
}
```

### With `?include=field_name`

The named relation is fully resolved and embedded:

```json
{
  "photo_cards": [
    { "id": "uuid-1", "photo_card_title": "...", "photo_card_image": { ... } }
  ],
  "blog_category": { "id": "uuid-3", "daily_title": "..." }
}
```

### Special Cases

**Paragraphs:** Nested paragraphs within an included paragraph are always auto-populated — no nested include syntax needed.

**Media fields (`image`, `video`, `file`):** Always fully resolved regardless of `?include=`. There is no useful case for returning just a media ID.

### Error Codes

| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_INCLUDE_FIELD` | 400 | `include` references a field that doesn't exist or isn't a relation |
