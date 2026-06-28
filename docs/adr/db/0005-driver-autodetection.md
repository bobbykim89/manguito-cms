---
status: accepted
---

# Serverless (Neon HTTP) vs TCP driver is auto-detected from the connection URL

`createPostgresAdapter` selects its Drizzle driver from the connection URL: if the URL contains `neon.tech` it uses the Neon HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`); otherwise it uses a `pg` Pool over TCP (`drizzle-orm/node-postgres`). The developer can override with `serverless: true`/`false`. This exists because standard Postgres TCP requires a persistent socket, which is slow and unreliable across serverless cold starts, whereas the Neon HTTP driver is stateless HTTP/1.1 and matches the Lambda/Vercel execution model.

## Considered Options

- **Always TCP** — rejected: breaks or badly degrades on serverless deployments, a primary target (Neon is the documented serverless DB).
- **Require an explicit `serverless` flag** — rejected as the default: detecting `neon.tech` makes the common case zero-config; the explicit flag remains as an override for edge cases (Neon URL but wanting TCP, or a non-Neon serverless Postgres).

## Consequences

- URL string-sniffing drives an infrastructure-level choice — surprising at a glance, hence this record. The override flag is the escape hatch.
- TCP pool tuning (`max`, `idle_timeout`, `connect_timeout`) only applies on the TCP path; it is inert on the Neon HTTP path.
