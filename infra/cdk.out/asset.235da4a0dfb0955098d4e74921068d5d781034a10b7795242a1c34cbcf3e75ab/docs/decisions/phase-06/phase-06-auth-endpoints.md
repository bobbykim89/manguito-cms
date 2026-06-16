# Decision — Auth Endpoints

> Login, refresh, logout behavior, rate limiting, and password reset scope.

---

## Endpoints

```
POST /admin/api/auth/login    — issue auth_token and refresh_token cookies
POST /admin/api/auth/refresh  — issue new auth_token using refresh_token
POST /admin/api/auth/logout   — increment token_version, clear cookies
```

All three are excluded from the OpenAPI spec — documenting exact cookie names and token structure in a publicly accessible spec is an unnecessary security surface.

---

## Login — `POST /admin/api/auth/login`

**Request body:**
```json
{ "email": "user@example.com", "password": "plaintext" }
```

**On success:**
- Verifies email exists in DB
- Verifies password against `password_hash` using `bcryptjs.compare`
- Issues `auth_token` (2hr) and `refresh_token` (7 days) as httpOnly cookies
- Returns user info in response body — tokens stay in cookies only

```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "editor"
  }
}
```

The admin panel uses this response to bootstrap Pinia state without a second roundtrip. Raw tokens are never returned in the body — they are httpOnly cookies and JavaScript cannot read them.

**On failure:**
Both wrong password and unknown email return the same generic error — no distinction exposed to prevent user enumeration:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password."
  }
}
```

---

## Login Rate Limiting

The login endpoint is rate limited by **IP + email combination** to prevent brute-force attacks:

| Setting | Value |
|---------|-------|
| Limit | 10 attempts |
| Window | 15 minutes |
| Scope | Per IP + email combination |
| Response | `429 RATE_LIMITED` with `Retry-After` header |

Scoping to IP + email (not IP alone) means a user who genuinely forgot their password is only blocked if they've repeatedly attempted the same email. No account lockout — lockout creates a denial-of-service vector where attackers can intentionally lock out legitimate users.

---

## Refresh — `POST /admin/api/auth/refresh`

**Behavior:**
- Reads `refresh_token` from httpOnly cookie (path-scoped to `/admin/api/auth`)
- Verifies refresh token signature and `token_version`
- Issues a new `auth_token` cookie only — **refresh token is not rotated**
- Returns `{ ok: true }`

**Refresh token rotation:** The `refresh_token` stays valid for its full 7-day lifetime. A new `refresh_token` is only issued on a fresh login. This is standard practice — simpler and predictable for the client.

**On failure:** `401 TOKEN_INVALID` or `401 TOKEN_EXPIRED`

---

## Logout — `POST /admin/api/auth/logout`

**Behavior:**
- Increments `token_version` in DB — immediately invalidates all existing tokens for the user
- Clears both `auth_token` and `refresh_token` cookies
- Returns `{ ok: true }`

No request body needed — acting user is identified from the `auth_token` cookie.

---

## Password Reset Scope

| Scenario | Mechanism |
|----------|-----------|
| Admin forgot password (has terminal access) | `manguito users:reset-password` CLI command — Phase 9 |
| Admin resets a subordinate's password | `POST /admin/api/users/:id/reset-password` — Phase 6 |
| User changes their own password | `POST /admin/api/users/change-password` — Phase 6 |
| Forgot password email flow | Deferred to post-MVP — requires email provider integration |

Email-based password reset is explicitly out of scope for MVP. It would require an email provider dependency (e.g. nodemailer) that is not essential for a self-hosted CMS where admins have terminal access.
