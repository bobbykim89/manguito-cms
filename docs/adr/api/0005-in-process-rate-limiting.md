---
status: accepted
---

# In-process sliding-window rate limiting — a deliberate v1 limitation

Rate limiting is implemented as in-process Hono middleware with no external dependency (no Redis/Upstash in v1). It uses a sliding window (not fixed, which has a boundary-burst hole) and applies two scopes simultaneously: a per-IP budget and a global ceiling across all IPs, so neither a single client nor a distributed burst can monopolise the endpoint. It guards only the two endpoints that need it — the unauthenticated `findAll` bulk-fetch (authenticated requests are fully exempt, so SSG builds should authenticate) and login (scoped per IP+email, no account lockout, to avoid a denial-of-service vector where an attacker locks out a real user).

## Considered Options

- **Redis-backed limiting** — rejected for v1: adds an infrastructure dependency a self-hosted CMS shouldn't require out of the box. It is the documented v2 path for serverless-at-scale.
- **Per-IP only** — rejected for login: an attacker rotating emails from one IP, or genuine users behind shared NAT, are handled better by the IP+email scope; a global ceiling additionally covers distributed abuse.
- **Account lockout** — rejected: lockout itself is a DoS vector.

## Consequences

- **Known limitation:** in-process state resets on every serverless cold start, so on Lambda/Vercel the limit is per-instance, not global. Accepted for v1.
- Rate-limit middleware runs *after* auth middleware so authenticated requests can be exempted before the limiter sees them. Limits are configurable via `createCmsApp({ rateLimit: { findAll: {...} } })`.
- **Amendment (2026-07, security round):** login now also enforces a global
  attempt ceiling (`GLOBAL_LOGIN_MAX`, 15-min window) across all IP+email keys,
  matching the two-scope (per-key + global) model of the `findAll` limiter. This
  blunts distributed email-spraying (audit Finding #5) while preserving the
  no-account-lockout decision. Like all in-process state, the global ceiling is
  per-instance on serverless; Redis-backed global limiting remains the v2 path.
