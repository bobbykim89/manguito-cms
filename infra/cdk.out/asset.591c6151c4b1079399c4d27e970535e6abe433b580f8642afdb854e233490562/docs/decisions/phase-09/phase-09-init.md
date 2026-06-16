# Decision — `manguito init`

> Defines the scaffolding command — argument behavior, interactive prompts, scaffolded files, and post-scaffold output.

---

## Overview

`manguito init` is the first command a developer runs. It scaffolds a complete, working Manguito CMS project from a set of plain template files bundled inside the CLI package.

---

## Argument Behavior

```bash
manguito init my-project    # creates my-project/ directory, scaffolds inside it
manguito init               # scaffolds into the current working directory
manguito init .             # same as above — scaffolds into current directory
```

**Non-empty target directory → abort with clear error:**

```
✖ Directory "my-project" already exists and is not empty.
  Choose a different name, or run `manguito init` inside an empty directory.
```

Empty existing directories are allowed — only non-empty directories are rejected.

---

## Interactive Prompts

Two questions are asked. DB URL is intentionally excluded — it is left as a placeholder in `.env.example` for the developer to fill in manually during setup.

```
Manguito CMS — New Project

? Project name: my-project
? Storage adapter: (Use arrow keys)
  ❯ Local filesystem
    Amazon S3
    Cloudinary
```

If the project name was provided as a CLI argument, it is used as the default for the name prompt (developer can confirm or override).

---

## Scaffolded Files

```
<target>/
├── manguito.config.ts             ← uses projectName, storageAdapter
├── schemas/
│   ├── content-types/
│   │   └── blog-post.json         ← simple example with a few fields
│   ├── paragraph-types/           ← empty directory (gitkeep)
│   └── taxonomy-types/
│       └── tag.json               ← simple example
├── roles.json                     ← default five-role hierarchy (rarely needs customising)
├── routes.json                    ← one placeholder base path as example
├── .env.example                   ← DB_URL + storage-specific vars as placeholders
├── .gitignore                     ← node_modules/, dist/, .manguito/, .env*
├── package.json                   ← scripts + manguito-cms dependency
├── tsconfig.json
└── README.md                      ← project-specific usage docs
```

### `roles.json` — Default Five-Role Hierarchy

Scaffolded with the standard Manguito role set. Most projects will not need to modify this.

```json
[
  { "name": "admin",   "hierarchy_level": 1, "permissions": ["*"] },
  { "name": "manager", "hierarchy_level": 2, "permissions": ["content.*", "media.*", "taxonomy.*", "users.read"] },
  { "name": "editor",  "hierarchy_level": 3, "permissions": ["content.*", "media.*", "taxonomy.*"] },
  { "name": "writer",  "hierarchy_level": 4, "permissions": ["content.create", "content.read", "media.upload"] },
  { "name": "viewer",  "hierarchy_level": 5, "permissions": ["content.read", "media.read"] }
]
```

### `routes.json` — Placeholder Base Path

```json
[
  { "base_path": "posts", "content_type": "blog_post", "published_only": true }
]
```

Developer modifies or removes this as their project requires.

### `.env.example` — Storage-Aware

The storage adapter chosen during init determines which vars appear:

**Local filesystem:**
```
DB_URL=postgres://user:password@localhost:5432/mydb
STORAGE_LOCAL_UPLOAD_DIR=./uploads
```

**Amazon S3:**
```
DB_URL=postgres://user:password@localhost:5432/mydb
STORAGE_S3_BUCKET=
STORAGE_S3_REGION=
STORAGE_S3_ACCESS_KEY_ID=
STORAGE_S3_SECRET_ACCESS_KEY=
```

**Cloudinary:**
```
DB_URL=postgres://user:password@localhost:5432/mydb
STORAGE_CLOUDINARY_CLOUD_NAME=
STORAGE_CLOUDINARY_API_KEY=
STORAGE_CLOUDINARY_API_SECRET=
```

---

## Post-Scaffold Output

```
✔ Created my-project/
✔ Scaffolded 12 files

Next steps:
  cd my-project
  cp .env.example .env
  # Set DB_URL (and storage credentials) in .env
  pnpm install
  pnpm dev
```

The "next steps" block tells the developer exactly what to do next — consistent with the guided output design value throughout the project.

---

## Template Variable Reference

| Variable | Source |
|----------|--------|
| `{{projectName}}` | CLI argument or name prompt |
| `{{storageAdapter}}` | Storage adapter prompt (`local` / `s3` / `cloudinary`) |

Templates with no variables are copied as-is (e.g. `tsconfig.json`, `roles.json`).

---

## Implementation Notes

- Templates live in `src/templates/` and are copied to `dist/templates/` at build time
- `renderTemplate(content, vars)` from `utils/template.ts` handles substitution
- File writes use `fs.mkdirSync` with `{ recursive: true }` for nested directories
- `paragraph-types/` is an empty directory — include a `.gitkeep` so it is committed
- The `manguito.config.ts` template should include commented examples for all three storage adapter options, with the chosen adapter uncommented
