import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'

// DOMPurify needs a DOM to run under Node. Create one JSDOM window once and
// reuse it across calls.
const purify = createDOMPurify(
  new JSDOM('').window as unknown as Parameters<typeof createDOMPurify>[0],
)

// Strip active content from an SVG (script elements, on* event handlers,
// javascript: URIs, <foreignObject>, external references) so it is safe to
// store and serve inline. Uses DOMPurify's SVG profile and returns sanitized
// SVG markup.
export function sanitizeSvg(svg: string): string {
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
}
