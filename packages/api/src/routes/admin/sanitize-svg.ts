import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'

// DOMPurify needs a DOM to run under Node. Build it lazily on first use so that
// merely importing this module (e.g. during `manguito build`) never spins up
// jsdom, and cold starts that never sanitize an SVG don't pay for it. jsdom is
// marked external in the bundlers (see the api/cli tsup configs) so it loads
// from node_modules, where its asset files resolve correctly.
let purify: ReturnType<typeof createDOMPurify> | null = null

function getPurify(): ReturnType<typeof createDOMPurify> {
  if (!purify) {
    purify = createDOMPurify(
      new JSDOM('').window as unknown as Parameters<typeof createDOMPurify>[0],
    )
  }
  return purify
}

// Strip active content from an SVG (script elements, on* event handlers,
// javascript: URIs, <foreignObject>, external references) so it is safe to
// store and serve inline. Uses DOMPurify's SVG profile and returns sanitized
// SVG markup.
export function sanitizeSvg(svg: string): string {
  return getPurify().sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  })
}
