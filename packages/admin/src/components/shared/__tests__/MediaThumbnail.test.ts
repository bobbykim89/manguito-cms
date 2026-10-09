import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaThumbnail from '../MediaThumbnail.vue'

const image = { type: 'image' as const, url: 'https://cdn.example.com/a.jpg', mime_type: 'image/jpeg', alt: 'A cat' }
const video = { type: 'video' as const, url: 'https://cdn.example.com/clip.mp4', mime_type: 'video/mp4' }
const pdf = { type: 'file' as const, url: 'https://cdn.example.com/report.pdf', mime_type: 'application/pdf' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MediaThumbnail', () => {
  it('renders an image as a lazy <img> with its alt text', () => {
    // MUTATION: render every item through the video or file branch.
    const img = mount(MediaThumbnail, { props: { item: image } }).get('img')
    expect(img.attributes('src')).toBe(image.url)
    expect(img.attributes('alt')).toBe('A cat')
    expect(img.attributes('loading')).toBe('lazy')
  })

  it('renders a video as a muted, metadata-only <video> seeked to its first frame', () => {
    // MUTATION: drop `#t=0.1` or use preload="auto". The frame is then either
    // black (time 0 on some codecs) or the whole file downloads per thumbnail.
    const v = mount(MediaThumbnail, { props: { item: video } }).get('video')
    expect(v.attributes('src')).toBe(`${video.url}#t=0.1`)
    expect(v.attributes('preload')).toBe('metadata')
    expect((v.element as HTMLVideoElement).muted).toBe(true)
    expect(v.attributes('controls')).toBeUndefined()
  })

  it('falls back to the video icon when the frame cannot load', async () => {
    // MUTATION: ignore the video's error event. A broken file then shows an
    // empty black box instead of an icon.
    const w = mount(MediaThumbnail, { props: { item: video } })
    await w.get('video').trigger('error')
    expect(w.find('video').exists()).toBe(false)
    expect(w.text()).toContain('VIDEO')
  })

  it('loads the video only once it scrolls into view', async () => {
    // MUTATION: bind `src` immediately. A grid of many videos then fetches every
    // file's metadata at once.
    let fire: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          fire = cb
        }
        observe() {}
        disconnect() {}
      }
    )
    const w = mount(MediaThumbnail, { props: { item: video } })
    expect(w.get('video').attributes('src')).toBeUndefined()
    fire!([{ isIntersecting: true }])
    await w.vm.$nextTick()
    expect(w.get('video').attributes('src')).toBe(`${video.url}#t=0.1`)
  })

  it('renders a file as a typed badge with its caption lines', () => {
    // MUTATION: render the old generic glyph. The badge text and the caption
    // lines disappear.
    const w = mount(MediaThumbnail, { props: { item: pdf, label: 'report.pdf', detail: '1.2 MB' } })
    expect(w.get('[data-testid="file-badge"]').text()).toBe('PDF')
    expect(w.text()).toContain('report.pdf')
    expect(w.text()).toContain('1.2 MB')
  })

  it('omits the caption lines when none are given', () => {
    // MUTATION: always render the file name, which crowds the small field preview.
    const w = mount(MediaThumbnail, { props: { item: pdf } })
    expect(w.text().trim()).toBe('PDF')
  })
})
