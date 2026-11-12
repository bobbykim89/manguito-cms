import { createHmac } from 'node:crypto'
import { testRoleUsers } from './fixtures.js'

// ─── JWT signing ──────────────────────────────────────────────────────────────

function base64urlEncode(input: string): string {
  return Buffer.from(input).toString('base64url')
}

async function signAuthToken(payload: {
  user_id: string
  role: string
  token_version: number
}): Promise<string> {
  const secret = process.env['AUTH_SECRET'] ?? 'test-secret'
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64urlEncode(
    JSON.stringify({
      ...payload,
      expires_at: Math.floor(Date.now() / 1000) + 2 * 60 * 60,
    }),
  )
  const data = `${header}.${body}`
  const signature = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

// ─── App shape ───────────────────────────────────────────────────────────────

// The part of a Hono app the helper uses. Typed structurally so this package
// needs no api import: api tests pass an app built from api's source, the
// sandbox one built from the published package.
export type TestApp = {
  request: (path: string, init: RequestInit) => Response | Promise<Response>
}

// ─── Authenticated request helper ─────────────────────────────────────────────

export type TestRole = 'admin' | 'manager' | 'editor' | 'writer' | 'viewer'

export async function authenticatedRequest(
  app: TestApp,
  role: TestRole,
  method: string,
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const user = testRoleUsers.find((u) => u.role === role)
  if (!user) {
    throw new Error(`No test user found for role "${role}"`)
  }

  const token = await signAuthToken({
    user_id: user.id,
    role: user.role,
    token_version: user.token_version,
  })

  const headers: Record<string, string> = {
    ...options?.headers,
    cookie: `auth_token=${token}`,
  }

  if (options?.body !== undefined) {
    headers['content-type'] = headers['content-type'] ?? 'application/json'
  }

  return app.request(path, {
    method,
    headers,
    ...(options?.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  })
}
