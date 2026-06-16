# Deploying to AWS Fargate

This documents every obstacle encountered when first deploying the Manguito CMS
sandbox to AWS Fargate via `pnpm deploy:fargate`, and the fix applied for each.
Use it as a pre-flight checklist for subsequent deploys or when setting up a new
AWS account/region.

---

## Prerequisites

- AWS IAM user with the `ManguitoCdkWorkerPolicy` attached (see
  `infra/lib/iam-worker-stack.ts` for the exact statements required)
- `infra/.env` populated — copy `infra/.env.example` and fill in values
- Docker running locally (image is built and pushed during `cdk deploy`)
- pnpm 10.x installed (`corepack enable` + `packageManager` field in root
  `package.json` pins the exact version)

---

## The deploy command

```bash
cd infra
# Load env then deploy (cdk reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# from the shell, not from infra/.env directly)
set -a && source .env && set +a
pnpm deploy:fargate
```

Which runs: `cdk deploy FargateStack --require-approval never`

---

## Architecture overview

```
Browser (HTTPS)
    │
    ▼
CloudFront (*.cloudfront.net — AWS-managed TLS cert)
    │  HTTP  (origin protocol)
    ▼
Application Load Balancer (HTTP:80)
    │
    ▼
Fargate task — node dist/server.js (PORT=3000)
    │                │
    ▼                ▼
Neon Postgres    S3 bucket
(Neon HTTP driver, (IAM role grant,
 public internet)   no static creds)
```

CloudFront is required because the app sets auth cookies with `Secure: true`.
Browsers only accept and send `Secure` cookies over HTTPS — without CloudFront
the login flow silently drops the `Set-Cookie` response and the user appears
permanently logged out.

---

## Issues encountered and fixes applied

### 1. CDK bootstrap drift — asset bucket missing

**Symptom**
```
FargateStack: fail: No bucket named 'cdk-hnb659fds-assets-<account>-<region>'.
Is account <account> bootstrapped?
```
Running `cdk bootstrap` again prints "(no changes)". Running `cdk bootstrap
--force` prints "CloudFormation reported that the deployment would not make any
changes."

**Root cause**
CloudFormation's `CDKToolkit` stack record showed `CREATE_COMPLETE` for the S3
staging bucket, but the actual bucket had been deleted outside CloudFormation
(drift). CDK trusted the stack record and assumed the bucket existed.

**Fix**
Delete the broken `CDKToolkit` stack and recreate it:

```bash
# delete
node -e "
const { CloudFormationClient, DeleteStackCommand } = require('@aws-sdk/client-cloudformation')
const c = new CloudFormationClient({ region: process.env.AWS_REGION })
c.send(new DeleteStackCommand({ StackName: 'CDKToolkit' })).then(() => console.log('done'))
"
# wait for deletion, then bootstrap fresh
npx cdk bootstrap aws://<account>/<region>
```

> **Note:** This recreates the bootstrap IAM roles (`cdk-hnb659fds-*`) with the
> same names. If you have other stacks deployed they will reuse the new roles
> transparently.

---

### 2. Docker credential helper failure (`pass not initialized`)

**Symptom**
```
docker login ... exited with error code 1:
error saving credentials: error storing credentials - err: exit status 1,
out: `pass not initialized: exit status 1: Error: password store is empty.
Try "pass init".`
```

**Root cause**
`~/.docker/config.json` contained `"credsStore": "desktop"`, directing Docker
to use `docker-credential-desktop`. On a headless Linux environment that helper
falls back to the `pass` GPG store, which is uninitialised.

**Fix**
Remove the `credsStore` entry so Docker stores credentials as base64 in the
`auths` block directly:

```bash
# back up first
cp ~/.docker/config.json ~/.docker/config.json.bak
# then remove the "credsStore" key from ~/.docker/config.json
```

After this, `docker login` writes credentials to the JSON file and ECR pushes
work without a credential helper.

---

### 3. `pnpm install --frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS`

**Symptom** (inside Docker build layer)
```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.18.20, esbuild@0.25.12,
esbuild@0.27.7, msw@2.14.6, vue-demi@0.14.10
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
exit code: 1
```

**Root cause**
pnpm 10 blocks dependency lifecycle scripts by default (security feature). On a
completely fresh `node_modules` (as in every Docker build) it treats unapproved
build scripts as an error. The Docker build used `corepack enable` without a
pinned version, potentially downloading a newer pnpm that is stricter.

**Fix**
Two changes to the monorepo root:

1. Pin pnpm version in `package.json` so corepack uses the tested version in
   all environments:
   ```json
   "packageManager": "pnpm@10.32.1"
   ```

2. Allow all build scripts unconditionally in `.npmrc` (acceptable for a
   private monorepo Docker build — the packages are all from the same workspace
   or trusted registry):
   ```
   dangerously-allow-all-builds=true
   ```

---

### 4. `sh: manguito: not found` during sandbox build

**Symptom** (inside Docker build layer)
```
> sandbox@0.0.0 build /repo/apps/sandbox
> manguito build --env .env
sh: manguito: not found
```

**Root cause**
pnpm creates bin symlinks at `pnpm install` time. The `manguito` bin symlink in
`apps/sandbox/node_modules/.bin/` points to `packages/cli/dist/index.js`, which
doesn't exist yet at install time (the CLI hasn't been built). pnpm logs a
warning and skips the symlink. Running the sandbox build before building the CLI
therefore fails with `not found`.

Using `pnpm exec turbo run build --filter="sandbox..."` also fails because turbo
detects a circular dependency via `@bobbykim/manguito-cms-test-utils`
(devDependency of db/api that also depends on them).

**Fix**
Build workspace packages in explicit dependency order in the Dockerfile, then
run a second `pnpm install` (fast — lockfile up to date, no downloads) to
recreate the now-valid bin symlink before building the sandbox:

```dockerfile
RUN pnpm --filter @bobbykim/manguito-cms-core run build && \
    pnpm --filter @bobbykim/manguito-cms-db run build && \
    pnpm --filter @bobbykim/manguito-cms-api run build && \
    pnpm --filter @bobbykim/manguito-cms-admin run build && \
    pnpm --filter @bobbykim/manguito-cms-cli run build && \
    pnpm install --frozen-lockfile
RUN pnpm --filter sandbox run build
```

---

### 5. `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` in pruned stage

**Symptom**
```
ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE  By default, starting from pnpm v10,
we only deploy from workspaces that have "inject-workspace-packages=true" set
If you want to deploy without using injected dependencies, run "pnpm deploy"
with the "--legacy" flag or set "force-legacy-deploy" to true
```

**Root cause**
pnpm v10 changed `pnpm deploy` to require injected dependencies by default.
The Dockerfile's pruned stage used `pnpm --filter sandbox deploy --prod /app`
without opting in to either mode.

**Fix**
Add to `.npmrc`:
```
force-legacy-deploy=true
```

This restores the pre-v10 behaviour where `pnpm deploy` copies workspace
packages from the store, which is correct for producing a self-contained
production bundle.

---

### 6. CDK deployment hung waiting for IAM approval

**Symptom**
```
Changeset ... created and waiting in review for manual execution (--no-execute)
Stack FargateStack
IAM Statement Changes
...
ELIFECYCLE  Command failed with exit code 1
```

**Root cause**
By default CDK pauses to show IAM diff and waits for interactive `y/n`
confirmation. When run non-interactively (script, CI) no confirmation arrives
and the process exits 1.

**Fix**
Add `--require-approval never` to the CDK deploy command in
`infra/package.json`:
```json
"deploy:fargate": "cdk deploy FargateStack --require-approval never"
```

---

### 7. ECS service failed to stabilize (ALB health check always 404)

**Symptom**
CloudFormation stack rolls back after ~10 minutes with:
```
CREATE_FAILED Service9571FDD8 | Resource handler returned message:
"Exceeded attempts to wait" (RequestToken: ..., HandlerErrorCode: NotStabilized)
```

**Root cause**
The ALB health check was configured on path `/`. The Manguito CMS server
returns 404 for any path that isn't `/api/*`, `/admin/*`, or `/uploads/*` (the
catch-all at the bottom of the generated `server.js`). The ALB target group had
`healthyHttpCodes: '200-399'`, so 404 was treated as unhealthy, the task was
never marked healthy, and CloudFormation timed out.

**Fix**
Change the health check path to `/api/openapi.json`, which is always registered
by `createCmsApp` and returns 200 with no authentication required:

```typescript
// infra/lib/fargate-stack.ts
service.targetGroup.configureHealthCheck({
  path: '/api/openapi.json',
  healthyHttpCodes: '200-399',
})
```

After a rollback, the stack must be deleted before re-deploying:
```bash
# Delete ROLLBACK_COMPLETE stack, then re-run pnpm deploy:fargate
cdk destroy FargateStack
# or via SDK if cdk destroy isn't available
```

---

### 8. Login silently fails — auth cookie not set over HTTP

**Symptom**
Submitting the login form appears to succeed (no error shown) but the user is
immediately redirected back to the login page. The `Set-Cookie` header from the
API response is silently discarded by the browser.

**Root cause**
`packages/api/src/auth/jwt.ts` sets auth cookies with `Secure: true`:

```typescript
setCookie(c, name, token, {
  httpOnly: true,
  secure: true,      // ← browsers reject this on plain HTTP
  sameSite: 'Strict',
})
```

The ALB only serves HTTP. Browsers do not store or send cookies that have the
`Secure` attribute when received over a non-HTTPS connection, so the auth cookie
is dropped and every subsequent request appears unauthenticated.

**Fix**
Add a CloudFront distribution in front of the ALB (`infra/lib/fargate-stack.ts`):

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'

const distribution = new cloudfront.Distribution(this, 'Distribution', {
  defaultBehavior: {
    origin: new origins.HttpOrigin(service.loadBalancer.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
  },
})
```

Both `aws-cloudfront` and `aws-cloudfront-origins` are included in
`aws-cdk-lib` — no additional package installs required.

Key decisions:
- `CACHING_DISABLED` — every request must reach the origin; the CMS is fully
  dynamic with no static cacheable responses
- `ALL_VIEWER_EXCEPT_HOST_HEADER` — forwards all headers, query strings, and
  cookies except `Host` (the ALB expects its own DNS name, not the CloudFront
  domain, in `Host`)
- `ALLOW_ALL` methods — the API uses POST/PUT/PATCH/DELETE, not just GET/HEAD
- No custom domain or ACM certificate needed — CloudFront provides a free
  `*.cloudfront.net` HTTPS URL with an AWS-managed certificate

**Always use the CloudFront URL**, not the ALB URL. The ALB is HTTP-only and
will not work with the admin panel login.

---

## Files changed from the baseline

| File | Change |
|------|--------|
| `package.json` | Added `"packageManager": "pnpm@10.32.1"` |
| `.npmrc` | Created — `dangerously-allow-all-builds=true`, `force-legacy-deploy=true` |
| `Dockerfile` | Explicit per-package build order + second `pnpm install` to fix bin symlinks |
| `infra/package.json` | Added `--require-approval never` to deploy scripts |
| `infra/lib/fargate-stack.ts` | Health check path `/api/openapi.json`; CloudFront distribution added |
| `~/.docker/config.json` | Removed `"credsStore": "desktop"` (one-time machine setup) |

---

## Final verification

```bash
# Health check — should return 200
curl -s -o /dev/null -w "%{http_code}" \
  https://<cloudfront-domain>/api/openapi.json

# Auth guard — should return UNAUTHORIZED JSON (server running, auth working)
curl -s https://<cloudfront-domain>/admin/api/config

# Admin panel — should serve the Vue SPA (HTML response)
curl -s -o /dev/null -w "%{http_code}" \
  https://<cloudfront-domain>/admin
```

The CloudFront domain is printed as `FargateStack.CloudFrontUrl` in the CDK
deploy output.
