# Decision — Rate Limiting

> Defines the rate limiting strategy for the `findAll` bulk fetch endpoint.

---

## Scope

Rate limiting applies to the `findAll` bulk fetch endpoint only. All other endpoints are not rate limited in v1.

**Authenticated requests are fully exempt** — valid `auth_token` cookie bypasses all rate limiting. SSG build processes should authenticate their requests to avoid any limit.

---

## Implementation

**Hono middleware, in-process.** No external dependency (Redis, Upstash, etc.) required in v1.

Tradeoff: in-process rate limiting uses in-memory state — it resets on every cold start in Lambda/Vercel. In serverless deployments, the limit is per-instance rather than global across all instances. This is a known limitation documented here. Redis-based rate limiting (e.g. Upstash) is the v2 solution for serverless deployments at scale.

---

## Strategy

**Sliding window** — counts requests in the last N milliseconds from the current moment, not from a fixed boundary.

Fixed window has a boundary burst problem: a consumer can make 30 requests at 11:59:59 and 30 more at 12:00:00, getting 60 requests in 2 seconds. Sliding window prevents this — no more than `maxPerIp` requests in any rolling `windowMs` span.

---

## Scope — Per-IP within Global Ceiling

Two limits apply simultaneously:

- **Per-IP limit:** Each client IP gets its own request budget. Prevents a single consumer from hitting the limit for others.
- **Global ceiling:** Total requests across all IPs within the window. Prevents distributed abuse from overwhelming the endpoint even when no single IP exceeds its per-IP limit.

```
Global ceiling: 500 req/min across all IPs
Per-IP limit:    30 req/min per individual IP

→ No single IP can starve others
→ No distributed burst can overwhelm the endpoint
```

**Known edge case:** Consumers behind shared NAT or corporate proxies appear as the same IP and share one per-IP budget. Unlikely to be a practical problem for a bulk SSG endpoint, but documented as a known limitation.

---

## Configuration

Rate limits are configurable in `createAPIAdapter`. Sensible defaults apply if omitted:

```ts
api: createAPIAdapter({
  storage: createLocalAdapter(),
  rateLimit: {
    findAll: {
      windowMs: 60_000,   // sliding window duration in ms — default: 60 seconds
      maxPerIp: 30,       // requests per IP per window — default: 30
      maxGlobal: 500,     // total requests across all IPs per window — default: 500
    }
  }
})
```

---

## Response

Returns `429 RATE_LIMITED` with headers indicating when the consumer can retry:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 43
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714521600
```

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please retry after 43 seconds."
  }
}
```

`Retry-After` is seconds until the oldest request in the sliding window falls out of scope — not a fixed reset time.

---

## Middleware Placement

Rate limiting middleware runs after auth middleware. Auth middleware must run first so authenticated requests can be exempted before the rate limiter sees them:

```
Request → /api/findAll
        ↓
1. Auth middleware — if valid auth_token → skip rate limiter entirely
2. Rate limiter middleware — check per-IP + global ceiling
3. Route handler
```
