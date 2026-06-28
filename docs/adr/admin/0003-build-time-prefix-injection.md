---
status: accepted
---

# Admin and API prefixes are injected at build time via Vite define, never hardcoded or runtime-fetched

The admin SPA refers to its mount prefix and the API prefix only through the global constants `__ADMIN_PREFIX__` and `__API_PREFIX__`, declared in `env.d.ts` and replaced at build time by Vite `define`. The CLI reads `manguito.config.ts` and injects the configured `admin.prefix` / `api.prefix` into the Vite config before building, for both `manguito dev` and `manguito build`. No string like `'/admin'` or `'/api'` is hardcoded anywhere in `src/`, and there is no bootstrap request to discover the prefixes.

## Considered Options

- **Hardcoded `/admin` and `/api`** — rejected: the prefixes are user-configurable in `createAdminAdapter`/`createAPIAdapter`; hardcoding would break any non-default deployment.
- **Runtime fetch of prefixes on app load** — rejected: a chicken-and-egg problem (you need a prefix to fetch the prefix) and an extra startup round-trip; the values are known at build time, so bake them in.

## Consequences

- Every API call, router path, and navigation guard composes from these constants — a reader seeing a bare global identifier instead of a literal path is seeing this decision.
- Tests must define these globals too (the MSW setup keys handlers off `__ADMIN_PREFIX__`).
- Changing a prefix requires a rebuild, not just a config reload — acceptable, since prefix changes are deployment-time decisions.
