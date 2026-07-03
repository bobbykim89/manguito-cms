import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '../sanitize-svg'

const NS = 'xmlns="http://www.w3.org/2000/svg"'

describe('sanitizeSvg', () => {
  it('removes <script> elements and their contents', () => {
    const clean = sanitizeSvg(`<svg ${NS}><script>alert(document.cookie)</script><rect/></svg>`)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('alert')
  })

  it('removes on* event handler attributes', () => {
    const clean = sanitizeSvg(`<svg ${NS}><rect onload="alert(1)" width="10" height="10"/></svg>`)
    expect(clean.toLowerCase()).not.toContain('onload')
  })

  it('strips javascript: URIs from links', () => {
    const clean = sanitizeSvg(`<svg ${NS}><a href="javascript:alert(1)"><rect/></a></svg>`)
    expect(clean.toLowerCase()).not.toContain('javascript:')
  })

  it('removes <foreignObject> (HTML-in-SVG) payloads', () => {
    const clean = sanitizeSvg(
      `<svg ${NS}><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject></svg>`,
    )
    expect(clean.toLowerCase()).not.toContain('foreignobject')
    expect(clean.toLowerCase()).not.toContain('onerror')
  })

  it('preserves benign SVG shapes', () => {
    const clean = sanitizeSvg(`<svg ${NS}><rect width="10" height="10" fill="#f00"/></svg>`)
    expect(clean).toContain('rect')
    expect(clean).toContain('width="10"')
  })
})
