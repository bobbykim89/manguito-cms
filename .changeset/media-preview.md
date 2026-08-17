---
"@bobbykim/manguito-cms-admin": minor
---

Preview video and open non-image media from the media detail page. Videos now play inline in a real player instead of showing a `▶` placeholder, and PDFs and other files get an "Open in new tab" link so they can actually be viewed — previously a non-image was a dead icon with no way to reach the file.

PDFs deliberately open in a new tab rather than embedding in an `<iframe>`: embedding storage-hosted files would require widening the admin's Content-Security-Policy with `frame-src` across every admin route, and a link requires no such exception. Inline video needs no CSP change, since `media-src` already permits the storage hosts.
