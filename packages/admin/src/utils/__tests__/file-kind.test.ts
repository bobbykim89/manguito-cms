import { describe, it, expect } from 'vitest'
import { fileKind, fileName } from '../file-kind'

describe('fileKind', () => {
  it('labels PDFs', () => {
    // MUTATION: drop the pdf rule. A PDF then falls back to its extension "PDF"
    // only by accident of its URL; with an extensionless URL it reads "FILE".
    expect(fileKind('application/pdf', 'https://cdn.example.com/abc')).toMatchObject({ label: 'PDF', tone: 'red' })
  })

  it('labels word-processing documents, whatever their exact MIME type', () => {
    // MUTATION: match only the legacy "application/msword". Modern .docx files
    // (the openxml type) and ODT/RTF would fall through to their extension.
    for (const mime of [
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/rtf',
    ]) {
      expect(fileKind(mime, 'https://cdn.example.com/x').label).toBe('DOC')
    }
  })

  it('labels spreadsheets, including CSV', () => {
    // MUTATION: match only the "spreadsheet" substring. CSV ("text/csv") would
    // then read as plain text.
    for (const mime of [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.oasis.opendocument.spreadsheet',
      'text/csv',
    ]) {
      expect(fileKind(mime, 'https://cdn.example.com/x').label).toBe('XLS')
    }
  })

  it('labels presentations and archives', () => {
    // MUTATION: drop the presentation or archive rules.
    expect(fileKind('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'u').label).toBe('PPT')
    expect(fileKind('application/vnd.ms-powerpoint', 'u').label).toBe('PPT')
    expect(fileKind('application/zip', 'u').label).toBe('ZIP')
    expect(fileKind('application/gzip', 'u').label).toBe('ZIP')
    expect(fileKind('application/x-7z-compressed', 'u').label).toBe('ZIP')
  })

  it('labels plain text and Markdown as TXT, but not CSV', () => {
    // MUTATION: test the text/* rule before the CSV rule. CSV then reads TXT.
    expect(fileKind('text/plain', 'u').label).toBe('TXT')
    expect(fileKind('text/markdown', 'u').label).toBe('TXT')
    expect(fileKind('text/csv', 'u').label).not.toBe('TXT')
  })

  it('falls back to the upper-cased extension of an unknown type', () => {
    // MUTATION: return "FILE" for every unknown type, losing the extension hint.
    expect(fileKind('application/octet-stream', 'https://cdn.example.com/media/model.glb')).toMatchObject({
      label: 'GLB',
      tone: 'gray',
    })
  })

  it('ignores the query string and fragment when reading the extension', () => {
    // MUTATION: take the text after the last "." of the whole URL. A signed URL
    // would then produce a label from its query string.
    expect(fileKind('application/octet-stream', 'https://cdn.example.com/a/b.step?X-Amz-Signature=abc.def').label).toBe('STEP')
  })

  it('falls back to FILE when there is no usable extension', () => {
    // MUTATION: return an empty label, which renders an empty badge.
    expect(fileKind('application/octet-stream', 'https://cdn.example.com/media/blob').label).toBe('FILE')
    expect(fileKind('application/octet-stream', 'https://cdn.example.com/media/archive.toolongext').label).toBe('FILE')
  })

  it('ignores MIME parameters such as a charset', () => {
    // MUTATION: compare the raw stored mime_type. "text/csv; charset=utf-8"
    // then misses the CSV rule and reads TXT, and a PDF with parameters reads
    // as its extension or FILE.
    expect(fileKind('text/csv; charset=utf-8', 'https://cdn.example.com/x').label).toBe('XLS')
    expect(fileKind('Application/PDF; name="a.pdf"', 'https://cdn.example.com/x').label).toBe('PDF')
  })

  it('recognises the archive MIME types browsers actually report', () => {
    // MUTATION: list only application/zip. Chrome on Windows reports .zip as
    // application/x-zip-compressed, which then reads as FILE.
    for (const mime of ['application/x-zip-compressed', 'application/x-gzip', 'application/x-rar-compressed', 'application/vnd.rar']) {
      expect(fileKind(mime, 'https://cdn.example.com/x').label).toBe('ZIP')
    }
  })
})

describe('fileName', () => {
  it('returns the last path segment without the query string or fragment', () => {
    // MUTATION: `url.split('/').pop()`. A signed URL's caption then reads
    // "report.pdf?X-Amz-Signature=…".
    expect(fileName('https://cdn.example.com/a/report.pdf?X-Amz-Signature=abc')).toBe('report.pdf')
    expect(fileName('https://cdn.example.com/a/clip.mp4#t=3')).toBe('clip.mp4')
  })

  it('falls back to the whole URL when there is no path segment', () => {
    // MUTATION: return '' for a URL ending in "/". The caption would be blank.
    expect(fileName('https://cdn.example.com/')).toBe('https://cdn.example.com/')
  })
})
