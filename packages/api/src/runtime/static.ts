import { resolve, sep } from 'node:path'

/**
 * Resolve a request sub-path against a base directory, returning the absolute
 * path only when it stays inside baseDir. Returns null for any path that
 * escapes (traversal, sibling-prefix). Pure — performs no filesystem access.
 */
export function resolveStaticFile(baseDir: string, urlSubPath: string): string | null {
  const base = resolve(baseDir)
  const rel = urlSubPath.startsWith('/') ? '.' + urlSubPath : './' + urlSubPath
  const candidate = resolve(base, rel)
  if (candidate === base || candidate.startsWith(base + sep)) {
    return candidate
  }
  return null
}

/** Extensions safe to serve inline for untrusted user uploads (Finding #2). */
export const SAFE_INLINE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
}

/** MIME map for trusted, build-produced admin SPA assets. */
export const ADMIN_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript',
  mjs: 'application/javascript',
  css: 'text/css',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  webp: 'image/webp',
}
