# Decision — Auth-Specific Test Concerns

> JWT expiry, token invalidation, cookie handling, rate limiting, and must_change_password testing.

---

## JWT Expiry — Clock Mocking

Testing token expiry without waiting for real time uses Vitest's `vi.useFakeTimers()`.

**Pattern:**

```ts
describe('expired token rejection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()   // ← always restore — never leave fake timers active
  })

  it('rejects a request with an expired auth_token', async () => {
    const app = createTestApp(testParsedSchema, db)

    // Issue a token that expires in 2 hours
    const token = signToken({ user_id: '...', role: 'editor', token_version: 0, expires_at: now + 2hr })

    // Advance clock past expiry
    vi.advanceTimersByTime(3 * 60 * 60 * 1000) // 3 hours

    const res = await app.request('/admin/api/content/articles', {
      headers: { Cookie: `auth_token=${token}` }
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('TOKEN_EXPIRED')
  })
})
```

**Critical:** `vi.useRealTimers()` must always be called in `afterEach`. Fake timers left active between tests cause async operations (DB queries, Promise resolution) to behave unpredictably in subsequent tests.

**Why not short-lived tokens:** Using a 1-second token lifetime and a real `await sleep(1100)` introduces real time dependencies — slow, flaky, and sensitive to CI environment timing. Clock mocking is deterministic and fast.

---

## Proactive Refresh

The auth middleware issues a new `auth_token` cookie when the existing token expires within 30 minutes. Test with clock mocking:

```ts
it('issues a new auth_token when token expires within 30 minutes', async () => {
  vi.useFakeTimers()

  // Issue token that expires in 20 minutes (within the 30-minute proactive window)
  const token = signToken({ ..., expires_at: now + 20min })

  const res = await app.request('/admin/api/content/articles', {
    headers: { Cookie: `auth_token=${token}` }
  })

  expect(res.status).toBe(200)
  const setCookie = res.headers.get('Set-Cookie')
  expect(setCookie).toContain('auth_token=')  // new token issued
})
```

---

## Token Version Invalidation

Tests that verify `token_version` mismatch rejection manipulate DB state directly — no clock mocking needed.

**Pattern:**

```ts
it('rejects token after logout increments token_version', async () => {
  // Log in to get a valid token (or use pre-signed token with token_version: 0)
  const token = signToken({ user_id: editorUser.id, role: 'editor', token_version: 0, ... })

  // Simulate logout by incrementing token_version in DB directly
  await db.getDb()
    .update(users)
    .set({ token_version: 1 })
    .where(eq(users.id, editorUser.id))

  const res = await app.request('/admin/api/content/articles', {
    headers: { Cookie: `auth_token=${token}` }
  })

  expect(res.status).toBe(401)
  expect(body.error.code).toBe('TOKEN_INVALID')
})
```

After the test, restore `token_version` to 0 for the global role user, or use a throwaway user created for this test.

**Preferred:** Use a throwaway user for token_version tests to avoid modifying the global role user fixtures.

---

## Cookie Attribute Verification

Login response must set cookies with correct security attributes. Test by inspecting `Set-Cookie` headers:

```ts
it('login sets auth_token and refresh_token with correct attributes', async () => {
  const res = await app.request('/admin/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'editor@test.local', password: '...' }),
    headers: { 'Content-Type': 'application/json' }
  })

  expect(res.status).toBe(200)

  const cookies = res.headers.getSetCookie()  // returns string[]

  const authCookie = cookies.find(c => c.startsWith('auth_token='))
  expect(authCookie).toContain('HttpOnly')
  expect(authCookie).toContain('SameSite=Strict')
  expect(authCookie).toContain('Secure')

  const refreshCookie = cookies.find(c => c.startsWith('refresh_token='))
  expect(refreshCookie).toContain('HttpOnly')
  expect(refreshCookie).toContain('Path=/admin/api/auth')  // path-scoped
})
```

---

## Rate Limiting

Rate limit tests require a **dedicated app instance** — in-memory rate limit state must not bleed into other tests.

```ts
describe('login rate limiting', () => {
  let rateLimitApp: HonoApp

  beforeEach(() => {
    rateLimitApp = createTestApp(testParsedSchema, db)  // fresh instance = fresh state
  })

  it('returns RATE_LIMITED after 10 failed attempts', async () => {
    const payload = JSON.stringify({ email: 'editor@test.local', password: 'wrongpassword' })

    for (let i = 0; i < 10; i++) {
      await rateLimitApp.request('/admin/api/auth/login', {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '1.2.3.4' }
      })
    }

    const res = await rateLimitApp.request('/admin/api/auth/login', {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '1.2.3.4' }
    })

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })
})
```

---

## `must_change_password` Tests

Use a throwaway user — do not modify the global role user fixtures.

```ts
describe('must_change_password enforcement', () => {
  let forcedUser: User

  beforeEach(async () => {
    // Create a user with must_change_password: true
    forcedUser = await createForcedPasswordUser(db)
  })

  afterEach(async () => {
    await teardownTestData(db, 'users', forcedUser.id)
  })

  it('blocks all routes except change-password', async () => {
    const token = signToken({ user_id: forcedUser.id, role: 'editor', token_version: 0, ... })

    const res = await app.request('/admin/api/content/articles', {
      headers: { Cookie: `auth_token=${token}` }
    })

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('allows the change-password route', async () => {
    const token = signToken({ user_id: forcedUser.id, role: 'editor', token_version: 0, ... })

    const res = await app.request('/admin/api/users/change-password', {
      method: 'POST',
      headers: { Cookie: `auth_token=${token}` },
      body: JSON.stringify({ current_password: '...', new_password: '...' })
    })

    expect(res.status).toBe(200)
  })
})
```

---

## Summary of Auth Test Tooling

| Concern | Approach |
|---------|----------|
| JWT expiry | `vi.useFakeTimers()` + `vi.useRealTimers()` in afterEach |
| Proactive refresh | Clock mocking, assert `Set-Cookie` header present |
| Token version invalidation | Direct DB update, throwaway user |
| Cookie attributes | `res.headers.getSetCookie()` inspection |
| Rate limiting | Dedicated `createTestApp()` instance per describe block |
| `must_change_password` | Throwaway user, `teardownTestData` in afterEach |
