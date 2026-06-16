# Decision — Media Library

> Defines the media library view, media modal, upload flow, and progress tracking.

---

## Two Distinct Media UI Concerns

| Concern | Component | Route |
|---------|-----------|-------|
| Standalone media management | `MediaLibraryView.vue` | `/admin/media` |
| In-form media selection | `MediaSelectModal.vue` | Modal — no route |

Both share the same media grid component — no duplication.

---

## Media Library View (`/admin/media`)

```
[ All | Images | Videos | PDFs ]    [ Orphaned ]    [ Upload ]
─────────────────────────────────────────────────────────────
[ item ] [ item ] [ item ] [ item ] [ item ] [ item ] ...
                    ↓ pagination
```

**Filter tabs:** All, Images, Videos, PDFs — maps to `?type=image|video|file`

**Orphaned tab:** `?orphaned=true` — shows files with `reference_count = 0`. Bulk delete available on this tab only.

**Upload button:** Opens the upload flow directly — no "select and confirm" step. Just upload and done.

**Grid item click:** Navigates to `/admin/media/:id`

---

## Media Detail View (`/admin/media/:id`)

Shows:
- Full metadata (mime type, file size, dimensions, duration)
- Alt text field (editable via `PATCH /admin/api/media/:id`)
- Which content items reference this file
- Delete button (disabled if `reference_count > 0`, shown with tooltip explaining why)

---

## Media Modal (`MediaSelectModal.vue`)

Opened by `MediaUpload.vue` from within content forms.

Same grid component as library view, with two additions:
- Pre-filtered and filter **locked** by the field's media type (image field → Images tab only)
- Footer with "Select" confirm button — disabled until an item is chosen

`MediaUpload.vue` owns the trigger button and the selected value display. `MediaSelectModal.vue` owns the grid and the confirm step.

---

## `MediaUpload.vue` — Upload Flow

`MediaUpload.vue` handles its own `fetch` independently from `useApiClient`. It uses `XMLHttpRequest` for upload progress tracking.

### Upload Path Decision

```
User selects or drops a file
  ↓
Read file.size vs max_file_size (from ui store, populated at bootstrap)
  ↓
file.size ≤ max_file_size → direct upload
file.size > max_file_size → presigned URL flow
```

Both flows end at the same place: media item created in DB, new item appears in grid pre-selected, alt text input shown.

### Direct Upload

```
POST /admin/api/media/image  (or /video or /file)
Content-Type: multipart/form-data
Body: { file: <binary>, alt?: string }
```

### Presigned URL Flow (video and large files)

```
1. GET /admin/api/media/presigned-url?type=...&filename=...&mime_type=...
   → returns { upload_url, media_id, expires_at }

2. PUT <upload_url>    ← direct to S3/Cloudinary, CMS server not involved
   Body: <binary>

3. POST /admin/api/media/confirm/:media_id
   Body: { alt: string }
```

The client determines which flow to use based on `file.size` vs `max_file_size`. This is transparent to the editor — the modal handles both flows internally.

### Progress Tracking

`XMLHttpRequest` with `upload.onprogress`:

```ts
const xhr = new XMLHttpRequest()
xhr.upload.onprogress = (event) => {
  if (event.lengthComputable) {
    uploadProgress.value = Math.round((event.loaded / event.total) * 100)
  }
}
```

This applies to both direct upload and the presigned PUT step.

### Alt Text

- **Images:** Optional at upload time. Input appears inline after upload completes within the modal.
- **Video and PDF:** Required at upload time. Input appears in the confirm step before the final `POST /confirm` call.

---

## `max_file_size` Source

`max_file_size` comes from the config bootstrap response (`GET /admin/api/config`) under `data.media.max_file_size`. Stored in the `ui` store after bootstrap. `MediaUpload.vue` reads it from the `ui` store when determining which upload path to take.

This value is not known at build time — it is a runtime configuration value from `createAPIAdapter({ media: { max_file_size: ... } })`.
