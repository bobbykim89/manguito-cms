# Decision — Media Endpoints and Upload Strategy

> Deferred to Phase 5 (REST API layer). Captured here from Phase 2 discussions for future reference.

---

## Media Table

System-managed table — not derived from any schema file. Created automatically by DB module on first run.

```ts
type MediaType = {
  id: string
  url: string
  mime_type: string
  alt?: string
  file_size: number       // bytes
  width?: number          // images and video
  height?: number         // images and video
  duration?: number       // video only, seconds
  reference_count: number // incremented/decremented on content create/update/delete
  created_at: Date
  updated_at: Date
}
```

`reference_count` tracks how many content items reference this media. When it reaches 0 the media is considered orphaned.

---

## Accepted Mime Types

| Endpoint | Accepted types |
| -------- | -------------- |
| `/admin/api/media/image` | `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml` |
| `/admin/api/media/video` | `video/mp4`, `video/webm`, `video/quicktime` |
| `/admin/api/media/file` | `application/pdf` |

ZIP files, executables, and other arbitrary file types are explicitly not accepted. PDF is the only `application/*` mime type supported.

---

## Upload Strategy

### Direct Upload (images and PDFs under global size limit)

```
POST /admin/api/media/image
POST /admin/api/media/file
Content-Type: multipart/form-data
Body: { file: <binary>, alt?: string }
```

### Presigned URL Upload (video and large files)

Files exceeding the global `max_file_size` bypass the CMS server entirely using presigned URLs. This avoids Lambda/Vercel request size limits.

```
1. GET /admin/api/media/presigned-url?type=video&filename=...&mime_type=video/mp4
   → returns { upload_url, media_id, expires_at }

2. PUT <upload_url>
   Body: <binary file>
   (Direct to S3/Cloudinary — CMS server not involved)

3. POST /admin/api/media/confirm/:media_id
   Body: { alt: string }
   → CMS writes metadata row to DB
```

The client determines which flow to use based on file size vs `max_file_size` from the config endpoint. This is transparent to the editor — the media modal handles both flows internally.

---

## Deployment Target Size Limits

| Service | Request size limit |
| ------- | ------------------ |
| AWS Lambda (API Gateway) | 10MB |
| Vercel (hobby) | 4.5MB |
| Vercel (pro) | 100MB |
| Traditional server | Configurable, no hard limit |

Default global `max_file_size` is 4MB — safely below the most restrictive common target. Configurable in `createAPIAdapter({ media: { max_file_size: ... } })`.

---

## Alt Text Handling

**Images:** Alt text input is optional at upload time. It appears inline after the upload completes within the media modal. Can be updated later via `PATCH /admin/api/media/:id`.

**Video and PDF:** Alt text is required at upload time. Provided in the confirm step of the presigned upload flow or as part of the direct upload form data.

---

## Unified Media Modal (WordPress-style)

All media fields (image, video, file) in content forms use the same modal component. There is no separate page for video/PDF uploads — everything goes through the modal.

```
Editor clicks media field
        ↓
Modal opens — shows grid of existing media
Filterable by type (All | Images | Videos | PDFs)
        ↓
Editor can:
  a) Select existing media → confirm
  b) Upload new file → drag/drop or file picker
        ↓
On upload:
  → MIME type detected from file
  → Small files: direct upload
  → Large files: presigned URL flow (transparent)
  → Alt text input appears after upload
  → New item appears in grid, pre-selected
        ↓
Editor confirms → media ID stored in content field
```

Field type pre-filters the grid (image field opens modal showing images only) but editor can clear the filter.

---

## Endpoint Map

```
-- upload
POST   /admin/api/media/image
POST   /admin/api/media/video
POST   /admin/api/media/file

-- presigned upload
GET    /admin/api/media/presigned-url?type=video&filename=...&mime_type=...
POST   /admin/api/media/confirm/:id

-- retrieval (public)
GET    /api/media                         — all media, paginated
GET    /api/media/:id                     — single media item
GET    /api/media?type=image              — filter by type
GET    /api/media?orphaned=true           — authenticated only

-- management (authenticated)
PATCH  /admin/api/media/:id               — update alt text
DELETE /admin/api/media/:id               — delete from storage and DB
```

---

## Orphan Tracking

Media with `reference_count = 0` is considered orphaned. Reference count is:
- Incremented when content referencing the media is created or updated to include it
- Decremented when content is deleted or updated to remove the reference
- SET NULL (not decremented) if content is cascade-deleted — orphan tracking handles cleanup

The admin panel Media Library page includes an "Orphaned Media" tab:

```sql
SELECT * FROM media WHERE reference_count = 0 ORDER BY created_at DESC
```

Editors review orphaned files and either delete them (removes from storage + DB) or keep them for future use.

DELETE operation:
1. Call storage adapter `delete(key)`
2. Delete DB row
3. If storage delete fails, DB row is not deleted — consistent state preserved

---

## Public vs Authenticated Access

Media metadata endpoints (`/api/media/*`) are publicly accessible. Media URLs are served directly from S3/Cloudinary/local — not proxied through the CMS server.

**Known limitation:** Media referenced by unpublished content is still accessible via its URL if guessed. Truly private/gated media serving is deferred to v2 as it requires authenticated URL generation and significantly more complexity.

---

## Storage Folder Structure

Files are stored in type-based subfolders:

```
{bucket or upload_dir}/
├── image/
│   └── {uuid}.{ext}
├── video/
│   └── {uuid}.{ext}
└── file/
    └── {uuid}.pdf
```

The folder is determined by the upload endpoint, not the mime type detection — this keeps the organization predictable and explicit.
