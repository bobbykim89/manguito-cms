// What a non-image, non-video media file looks like as a thumbnail: a short
// type label and a colour for its badge. Derived from the MIME type stored with
// the media item; the URL's extension is the fallback for types not listed.

export type FileTone = 'red' | 'blue' | 'green' | 'orange' | 'gray'

export type FileKind = { label: string; tone: FileTone }

// Tailwind background class for each badge tone.
export const TONE_CLASS: Record<FileTone, string> = {
  red: 'bg-red-600',
  blue: 'bg-blue-600',
  green: 'bg-green-600',
  orange: 'bg-orange-500',
  gray: 'bg-gray-500',
}

// Checked in order; the first match wins. CSV sits before the generic text/*
// rule so it reads as a spreadsheet, not as plain text.
const RULES: Array<{ test: (mime: string) => boolean; kind: FileKind }> = [
  { test: (m) => m === 'application/pdf', kind: { label: 'PDF', tone: 'red' } },
  {
    test: (m) =>
      m === 'application/msword' ||
      m === 'application/rtf' ||
      m.includes('wordprocessingml') ||
      m === 'application/vnd.oasis.opendocument.text',
    kind: { label: 'DOC', tone: 'blue' },
  },
  {
    test: (m) =>
      m === 'application/vnd.ms-excel' ||
      m === 'text/csv' ||
      m.includes('spreadsheetml') ||
      m === 'application/vnd.oasis.opendocument.spreadsheet',
    kind: { label: 'XLS', tone: 'green' },
  },
  {
    test: (m) =>
      m === 'application/vnd.ms-powerpoint' ||
      m.includes('presentationml') ||
      m === 'application/vnd.oasis.opendocument.presentation',
    kind: { label: 'PPT', tone: 'orange' },
  },
  {
    test: (m) =>
      m === 'application/zip' ||
      m === 'application/x-zip-compressed' ||
      m === 'application/gzip' ||
      m === 'application/x-gzip' ||
      m === 'application/x-tar' ||
      m === 'application/x-7z-compressed' ||
      m === 'application/x-rar-compressed' ||
      m === 'application/vnd.rar',
    kind: { label: 'ZIP', tone: 'gray' },
  },
  { test: (m) => m.startsWith('text/'), kind: { label: 'TXT', tone: 'gray' } },
]

// The file name a media URL ends in, without its query string or fragment
// (signed storage URLs carry both). Falls back to the whole URL when the path
// has no last segment.
export function fileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? ''
  return path.split('/').pop() || url
}

// The URL's extension, upper-cased, or '' when it has none worth showing.
function extensionOf(url: string): string {
  const name = fileName(url)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  const ext = name.slice(dot + 1)
  return /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toUpperCase() : ''
}

export function fileKind(mimeType: string, url: string): FileKind {
  // Stored MIME types can carry parameters ("text/csv; charset=utf-8").
  const mime = (mimeType.split(';')[0] ?? '').trim().toLowerCase()
  const rule = RULES.find((r) => r.test(mime))
  if (rule) return rule.kind
  return { label: extensionOf(url) || 'FILE', tone: 'gray' }
}
