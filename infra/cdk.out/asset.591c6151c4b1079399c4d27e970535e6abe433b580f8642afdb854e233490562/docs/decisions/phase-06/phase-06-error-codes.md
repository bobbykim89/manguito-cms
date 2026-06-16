# Decision — Phase 6 Error Code Additions

> New error codes introduced in Phase 6. All added to the `ErrorCode` enum in `@bobbykim/manguito-cms-core`.

---

## New Codes

| Code | HTTP | Trigger |
|------|------|---------|
| `INVALID_CREDENTIALS` | 401 | Login failed — wrong password or unknown email. Same code for both — no distinction exposed to prevent user enumeration |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Authenticated request blocked because `must_change_password` is `true`. Only `POST /admin/api/users/change-password` is exempt |
| `INVALID_ROLE` | 400 | Role name provided does not exist in the roles registry |

---

## Enum Addition

Add to `ErrorCode` in `@bobbykim/manguito-cms-core`:

```ts
type ErrorCode =
  // ... existing Phase 2 and Phase 5 codes ...

  // Phase 6 — auth
  | 'INVALID_CREDENTIALS'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'INVALID_ROLE'
```

---

## Response Shapes

**`INVALID_CREDENTIALS`**
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password."
  }
}
```

**`PASSWORD_CHANGE_REQUIRED`**
```json
{
  "ok": false,
  "error": {
    "code": "PASSWORD_CHANGE_REQUIRED",
    "message": "You must change your password before continuing."
  }
}
```

**`INVALID_ROLE`**
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_ROLE",
    "message": "Role \"super_admin\" does not exist."
  }
}
```

---

## Previously Defined Auth Codes (Phase 5)

These already exist in the `ErrorCode` enum from Phase 5 and are used in Phase 6 without modification:

| Code | HTTP | Used in Phase 6 for |
|------|------|---------------------|
| `UNAUTHORIZED` | 401 | No auth token present on `/admin/api/*` request |
| `TOKEN_EXPIRED` | 401 | Auth token expired — client should attempt refresh |
| `TOKEN_INVALID` | 401 | JWT signature invalid or tampered |
| `INSUFFICIENT_PERMISSION` | 403 | Valid token but role lacks required permission |
| `INSUFFICIENT_PRIVILEGE` | 403 | Acting user hierarchy level too low, or self role change / self delete attempted |
| `RATE_LIMITED` | 429 | Login rate limit exceeded |
