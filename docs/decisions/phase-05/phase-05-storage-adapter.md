# Decision — Storage Adapter Interface

> Defines the StorageAdapter interface, adapter factory signatures, and behavioral contracts for local, S3, and Cloudinary adapters.

---

## Interface

Defined in `@bobbykim/manguito-cms-core` — no storage SDK dependency:

All uploads use the presigned URL flow exclusively — the CMS server never handles binary file data. This keeps the server lightweight, avoids Lambda/Vercel request size limits entirely, and decouples upload volume from CMS server load.

```ts
interface StorageAdapter {
  readonly type: "local" | "s3" | "cloudinary"
  getPresignedUploadUrl(options: PresignedOptions): Promise<PresignedResult>
  getUrl(key: string): string
  delete(key: string): Promise<void>
}

type PresignedOptions = {
  folder: "image" | "video" | "file"
  filename: string
  mime_type: string
  expires_in?: number   // seconds, default: 3600
}

type PresignedResult = {
  upload_url: string    // client sends file here directly
  key: string           // media_id / storage key
  expires_at: number    // unix timestamp
}
```

---

## `getUrl` Usage

`getUrl(key)` is used **internally during the upload flow only** to construct the URL before storing it in the DB. After the URL is written to the DB, the DB value is the source of truth — `getUrl` is never called again at runtime to reconstruct URLs.

This keeps media URL serving simple: the DB has the full URL, serve it directly with no adapter involvement.

---

## `getPresignedUploadUrl` per Adapter

Each adapter implements presigned upload differently, but the `PresignedResult` shape is identical — the admin panel uses the same flow regardless of adapter.

### Local adapter — simulated presigned URL

The local adapter has no external service to sign against. It simulates the presigned flow by registering a temporary local endpoint on the CMS server:

```
1. GET /admin/api/media/presigned-url?type=video&filename=my-video.mp4
   → local adapter generates a short-lived token
   → returns: http://localhost:3000/_local_upload/{key}?token=xyz&expires=...

2. Client PUTs file to that local endpoint
   → local handler writes file to ./uploads/video/{uuid}.mp4

3. Client confirms — identical to S3/Cloudinary flow
   POST /admin/api/media/confirm/{key}
```

The admin panel's presigned URL flow works in local dev without any special-casing. From the admin panel's perspective, steps 2 and 3 are identical across all adapters.

### S3 adapter — real presigned PUT URL

```
1. CMS server calls S3 SDK to generate a time-limited signed URL
   → returns: https://my-bucket.s3.amazonaws.com/video/{uuid}.mp4?X-Amz-Signature=...

2. Client PUTs file directly to S3 — CMS server not involved

3. Client confirms with CMS server
```

### Cloudinary adapter — signed upload POST URL

Cloudinary uses signed upload presets instead of presigned URLs. The HTTP method is `POST` rather than `PUT` — this is an adapter implementation detail, not exposed to the admin panel.

```
1. CMS server generates a Cloudinary signed upload signature
   → returns: https://api.cloudinary.com/v1_1/{cloud_name}/video/upload
     (with signature, timestamp, api_key as upload params)

2. Client POSTs file directly to Cloudinary — CMS server not involved

3. Client confirms with CMS server
```

Cloudinary additionally handles image format conversion and quality optimization automatically on upload — no post-processing needed by the CMS.

---

## Adapter Factory Signatures

### `createLocalAdapter`

```ts
type LocalAdapterOptions = {
  upload_dir?: string     // default: './uploads'
}

export function createLocalAdapter(
  options: LocalAdapterOptions = {}
): StorageAdapter
```

**Production warning:** If `NODE_ENV === 'production'`, startup prints:

```
⚠ Warning: Local storage adapter is not recommended for production.
  Files will not persist across container restarts or serverless invocations.
  Consider createS3Adapter() or createCloudinaryAdapter() for production.
```

| Environment | Local adapter |
|-------------|---------------|
| Local development | ✓ Recommended |
| Traditional single VPS | ⚠ Works but not recommended |
| Containerized (Docker/ECS) | ✗ Files lost on redeploy |
| Serverless (Lambda/Vercel) | ✗ Fundamentally broken |

### `createS3Adapter`

```ts
type S3AdapterOptions = {
  bucket: string                 // required
  region: string                 // required
  prefix?: string                // optional folder prefix for all keys
  access_key_id?: string         // default: process.env.AWS_ACCESS_KEY_ID
  secret_access_key?: string     // default: process.env.AWS_SECRET_ACCESS_KEY
}

export function createS3Adapter(options: S3AdapterOptions): StorageAdapter
```

### `createCloudinaryAdapter`

```ts
type CloudinaryAdapterOptions = {
  cloud_name: string             // required
  folder?: string                // optional folder prefix
  access_key_id?: string         // default: process.env.CLOUDINARY_API_KEY
  secret_access_key?: string     // default: process.env.CLOUDINARY_API_SECRET
}

export function createCloudinaryAdapter(
  options: CloudinaryAdapterOptions
): StorageAdapter
```

---

## Storage Folder Structure

Files are stored in type-based subfolders — folder determined by upload endpoint, not mime type detection:

```
{bucket or upload_dir}/
├── image/
│   └── {uuid}.{ext}
├── video/
│   └── {uuid}.{ext}
└── file/
    └── {uuid}.pdf
```

---

## Delete Consistency

Delete operation always follows this order to maintain consistent state:

```
1. Call storage adapter delete(key)
2. Delete DB row

If storage delete fails → DB row is NOT deleted
If DB delete fails → storage file is orphaned (cleaned up via orphan tracking)
```

Storage is the source of truth for existence — the DB row is never deleted if the file cannot be removed first.
