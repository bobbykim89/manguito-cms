# Decision — Test Data and Seed Strategy

> How integration tests get the data they need, and who is responsible for setup and cleanup.

---

## Two Layers of Test Data

### Layer 1 — Global fixtures (set up once by globalSetup)

Data that nearly every test depends on. Created once before any test file runs, never torn down mid-suite.

| Data | How created | Who owns it |
|------|-------------|-------------|
| Migrations applied | `applyMigrations()` in `globalSetup` | globalSetup |
| Roles + base paths | `seedSystemTables()` in `globalSetup` | globalSetup |
| One user per role | Direct DB insert in `globalSetup` | globalSetup |

The five role users have predictable, stable credentials defined in `test-utils/fixtures.ts`. Every integration test that needs an authenticated request uses these users via `authenticatedRequest()`.

### Layer 2 — Test-specific data (set up and torn down per test)

Data that is specific to a single test or describe block. Created in `beforeEach` or at the start of the test, cleaned up in `afterEach` or at the end.

This applies to any test that **creates, updates, or deletes** records — content items, additional users, taxonomy terms, etc.

---

## Cleanup Responsibility

Write tests own their own cleanup. The pattern:

```ts
describe('content create', () => {
  let createdId: string

  afterEach(async () => {
    if (createdId) {
      await teardownTestData(db, 'articles', createdId)
    }
  })

  it('creates a content item', async () => {
    const res = await authenticatedRequest(app, 'editor', 'POST', '/admin/api/content/articles', { ... })
    createdId = res.data.id
    expect(res.ok).toBe(true)
  })
})
```

Using `teardownTestData()` from `test-utils/db.ts` keeps cleanup consistent and avoids raw SQL in test files.

---

## Test Config Fixture

All integration tests that need a `ParsedSchema` use `testParsedSchema` from `test-utils/fixtures.ts`. This fixture is:

- Minimal but realistic — not a toy schema
- Covers all four schema types: one content type, one paragraph type, one taxonomy type, one enum type
- Includes enough field types to exercise all codegen paths (text, richtext, number, boolean, reference, paragraph, media)
- Stable across phases — new field types are added to the fixture when introduced

A single shared fixture means tests are consistent and the fixture is maintained in one place.

---

## Role User Fixtures

Five users are inserted by `globalSetup`, one per role:

| Role | Email | Notes |
|------|-------|-------|
| admin | `admin@test.local` | Full permissions, hierarchy_level 0 |
| manager | `manager@test.local` | hierarchy_level 1 |
| editor | `editor@test.local` | hierarchy_level 2 |
| writer | `writer@test.local` | hierarchy_level 3 |
| viewer | `viewer@test.local` | hierarchy_level 4 |

All have `must_change_password: false` and known `token_version: 0`. Tests that need to test `must_change_password` or `token_version` behavior create their own separate users and clean them up.

---

## Test Ordering Within Files

Tests within a file follow the natural lifecycle order of a real operation:

```
describe('articles API') {
  it('creates an article')      ← POST
  it('reads the article')       ← GET :id
  it('lists articles')          ← GET (collection)
  it('updates the article')     ← PATCH
  it('deletes the article')     ← DELETE
}
```

This makes test files readable as narratives. State created by earlier tests may be used by later tests within the same describe block, provided cleanup runs in `afterEach` or `afterAll` at the block level.

---

## What Is Never Reset Mid-Suite

- Migrations
- System table seed (roles, base paths)
- Role user fixtures

If a test accidentally corrupts this data, subsequent tests may fail in confusing ways. Write tests must never touch the five role user records or the system seed data. If a test needs a user with unusual state (e.g. a deleted user, a user with `must_change_password: true`), it creates a new user and cleans it up — it does not modify the global role users.
