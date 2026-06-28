---
status: accepted
---

# Subpath exports isolate heavy cloud SDKs from the core API bundle

The api package ships three entry points: `.` (`createAPIAdapter` and route/middleware internals), `./storage` (`createLocalAdapter`, `createS3Adapter`, `createCloudinaryAdapter`), and `./runtime` (`createServer`, `createLambdaHandler`, `createVercelHandler`). Storage and runtime are split out because each adapter can pull in a heavy SDK (AWS SDK, Cloudinary SDK) or a runtime-specific shim. A user who imports only `createS3Adapter` should not also bundle the Cloudinary SDK, and someone deploying to Node shouldn't bundle Lambda/Vercel handlers.

## Considered Options

- **Single barrel entry point** — rejected: re-exporting every adapter from one module forces consumers to bundle SDKs they never use, since tree-shaking across these side-effecting SDK imports is unreliable.

## Consequences

- The public export surface is a contract: moving an adapter between subpaths is a breaking change, so the split is chosen deliberately, not incidentally.
- Generated code and the CLI import adapters from the specific subpath, not from `.`.
