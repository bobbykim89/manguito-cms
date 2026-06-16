import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { ParsedRole } from '@bobbykim/manguito-cms-core'

declare const __ADMIN_PREFIX__: string

export const testRoles: ParsedRole[] = [
  {
    name: 'admin',
    label: 'Admin',
    is_system: true,
    hierarchy_level: 100,
    permissions: [
      'content:read', 'content:create', 'content:edit', 'content:delete',
      'media:read', 'media:create', 'media:edit', 'media:delete',
      'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
      'users:read', 'users:create', 'users:edit', 'users:delete',
      'roles:read',
    ],
  },
  {
    name: 'editor',
    label: 'Editor',
    is_system: false,
    hierarchy_level: 50,
    permissions: [
      'content:read', 'content:create', 'content:edit',
      'media:read', 'media:create',
      'taxonomy:read',
    ],
  },
]

export const testUser = {
  id: 'test-uuid',
  email: 'editor@test.local',
  role: 'editor',
  must_change_password: false,
}

export const server = setupServer(
  http.get(`${__ADMIN_PREFIX__}/api/config`, () =>
    HttpResponse.json({
      ok: true,
      data: {
        cms_name: 'Test CMS',
        version: '1.0.0',
        roles: testRoles,
        user: testUser,
        media: { max_file_size: 4194304 },
      },
    })
  )
)
