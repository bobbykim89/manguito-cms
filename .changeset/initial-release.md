---
"@bobbykim/manguito-cms-core": minor
"@bobbykim/manguito-cms-db": minor
"@bobbykim/manguito-cms-api": minor
"@bobbykim/manguito-cms-admin": minor
"@bobbykim/manguito-cms-cli": minor
---

Initial public release (0.1.0).

Schema-driven headless CMS: define content types as JSON/YAML and the database
tables, REST API, and admin panel are generated from them. Includes the schema
parser and field-type registry (core), Drizzle/Postgres codegen and migrations
(db), the Hono API with route generation, storage adapters, and JWT auth (api),
the Vue 3 admin panel (admin), and the `manguito` CLI — `init`, `dev`, `build`,
`start`, `validate`, `migrate`, `createsuperuser`, and user management (cli).
Ships with user documentation (README, configuration and schema-authoring
guides) and accurate project scaffolding templates.
