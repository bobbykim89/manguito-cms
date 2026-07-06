import { describe, it, expect, vi } from 'vitest'
import type { ParsedRoles, ParsedRoutes, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '../../types'
import { seedSystemTables } from '../index'

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

type SelectRow = Record<string, unknown>
type ExecuteResult = { rows: SelectRow[] }

// Returns a value that can be both awaited directly (db.select().from()) and
// chained further (.where(), .innerJoin().where()). All paths resolve to the
// same result, which is the controlled data for that sequential select call.
function makeChain(result: SelectRow[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = Promise.resolve(result) as any
  p.where = vi.fn().mockResolvedValue(result)
  p.innerJoin = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(result),
  })
  return p
}

// Creates a mock DrizzlePostgresInstance driven by queues.
// Each call to db.select().from() consumes the next item from selectQueue.
// Each call to db.execute() consumes the next item from executeQueue.
function createMockDb(
  selectQueue: SelectRow[][],
  executeQueue: ExecuteResult[] = [],
): DrizzlePostgresInstance {
  let si = 0
  let ei = 0
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => makeChain(selectQueue[si++] ?? [])),
    })),
    execute: vi.fn().mockImplementation(() =>
      Promise.resolve(executeQueue[ei++] ?? { rows: [] }),
    ),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([]),
      }),
    }),
  } as unknown as DrizzlePostgresInstance
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  'content:read', 'content:create', 'content:edit', 'content:delete',
  'media:read', 'media:create', 'media:edit', 'media:delete',
  'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
  'users:read', 'users:create', 'users:edit', 'users:delete',
  'roles:read', 'roles:create', 'roles:edit', 'roles:delete',
] as const

const ADMIN_ONLY: ParsedRoles = {
  roles: [
    { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: [...ALL_PERMISSIONS] },
  ],
  valid_permissions: [...ALL_PERMISSIONS],
}

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }

function makeRegistry(roles: ParsedRoles, routes: ParsedRoutes): SchemaRegistry {
  return {
    routes,
    roles,
    schemas: {},
    content_types: {},
    paragraph_types: {},
    taxonomy_types: {},
    enum_types: {},
    all_schemas: [],
  }
}

// ─── checkBasePathsInUse — dependency detection ───────────────────────────────

describe('checkBasePathsInUse — dependency detection', () => {
  it('no matching base-path rows: deletion proceeds without error', async () => {
    // Scenario: 'old-route' exists in DB, not in incoming config → will be deleted.
    // checkBasePathsInUse finds no matching rows → safe to delete.
    const db = createMockDb(
      [
        // 1. seedRoles: select existing roles → admin already present, no deletion
        [{ name: 'admin' }],
        // 2. seedBasePaths: select existing base_paths → 'old-route' is present
        [{ name: 'old-route' }],
        // 3. checkBasePathsInUse: select base_paths by name → no rows returned
        [],
      ],
    )

    // No error expected; the deleted count reflects one path removed
    const result = await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))
    expect(result.base_paths.deleted).toBe(1)
  })

  it('matching base-path rows with content: table names appear in SEEDER_BASE_PATH_IN_USE error', async () => {
    // Scenario: 'old-route' exists, not in incoming config → deletion attempted.
    // checkBasePathsInUse finds the base path row and content rows referencing it.
    const db = createMockDb(
      [
        // 1. seedRoles: existing roles match → no deletion
        [{ name: 'admin' }],
        // 2. seedBasePaths: 'old-route' is present in DB
        [{ name: 'old-route' }],
        // 3. checkBasePathsInUse: base_paths row found by name
        [{ id: 'bp-uuid-1', name: 'old-route' }],
      ],
      [
        // 4. information_schema: one table has a base_path_id column
        { rows: [{ table_name: 'content_article' }] },
        // 5. COUNT for content_article: 2 rows reference this base path
        { rows: [{ count: '2' }] },
      ],
    )

    let caught: Error | undefined
    try {
      await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_BASE_PATH_IN_USE')
    expect(caught!.message).toContain('content_article')
  })
})

// ─── seedRoles — dependency check ────────────────────────────────────────────

describe('seedRoles — dependency check', () => {
  it('role assigned to a user blocks deletion with SEEDER_ROLE_IN_USE error', async () => {
    // Scenario: incoming has only admin, but editor exists in DB with a user assigned.
    const db = createMockDb([
      // 1. seedRoles: existing roles include admin + editor
      [{ name: 'admin' }, { name: 'editor' }],
      // 2. is_system roles among those being deleted — none
      [],
      // 3. Users assigned to the 'editor' role
      [{ id: 'u-1', email: 'occupied@example.com' }],
    ])

    let caught: Error | undefined
    try {
      await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_ROLE_IN_USE')
    expect(caught!.message).toContain('occupied@example.com')
    expect(caught!.message).toContain('editor')
  })

  it('role with no assigned users can be deleted without error', async () => {
    // Scenario: incoming has only admin; editor exists but has no users assigned.
    const db = createMockDb([
      // 1. seedRoles: existing roles include admin + editor
      [{ name: 'admin' }, { name: 'editor' }],
      // 2. is_system roles among those being deleted — none
      [],
      // 3. No users assigned to the 'editor' role
      [],
      // 4. seedBasePaths: no existing base paths
      [],
    ])

    const result = await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))

    expect(result.roles.deleted).toBe(1)
    expect(result.roles.inserted).toBe(0)
    expect(result.roles.updated).toBe(1) // admin was already present → updated
  })

  it('role marked is_system blocks deletion with SEEDER_SYSTEM_ROLE error', async () => {
    // Scenario: incoming has only admin; editor exists in DB and is is_system.
    const db = createMockDb([
      // 1. seedRoles: existing roles include admin + editor
      [{ name: 'admin' }, { name: 'editor' }],
      // 2. is_system roles among those being deleted — editor is protected
      [{ name: 'editor' }],
    ])

    let caught: Error | undefined
    try {
      await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_SYSTEM_ROLE')
    expect(caught!.message).toContain('editor')
  })
})

// ─── seedBasePaths — dependency check ────────────────────────────────────────

describe('seedBasePaths — dependency check', () => {
  it('base path with content rows blocks deletion with SEEDER_BASE_PATH_IN_USE error', async () => {
    // Scenario: incoming has only blog; db also has blog (no deletion). But if
    // we set incoming to empty and blog exists in DB, deletion is attempted and
    // blocked because content rows reference the blog base path.
    const db = createMockDb(
      [
        // 1. seedRoles: existing roles match incoming → no deletion
        [{ name: 'admin' }],
        // 2. seedBasePaths: 'blog' is present in DB, not in incoming → to delete
        [{ name: 'blog' }],
        // 3. checkBasePathsInUse: base_paths row found for 'blog'
        [{ id: 'bp-uuid-blog', name: 'blog' }],
      ],
      [
        // 4. information_schema: content_article table references base_path_id
        { rows: [{ table_name: 'content_article' }] },
        // 5. COUNT: 1 row in content_article references this base path
        { rows: [{ count: '1' }] },
      ],
    )

    let caught: Error | undefined
    try {
      await seedSystemTables(db, makeRegistry(ADMIN_ONLY, EMPTY_ROUTES))
    } catch (e) {
      caught = e as Error
    }

    expect(caught).toBeDefined()
    expect(caught!.message).toContain('SEEDER_BASE_PATH_IN_USE')
    expect(caught!.message).toContain('content_article')
    expect(caught!.message).toContain('blog')
  })
})
