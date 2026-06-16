import { describe, it, expect } from 'vitest'
import { renderTemplate } from '../utils/template.js'

describe('renderTemplate', () => {
  it('replaces a known {{variable}} placeholder', () => {
    expect(renderTemplate('Hello, {{name}}!', { name: 'World' })).toBe('Hello, World!')
  })

  it('replaces multiple occurrences of the same variable', () => {
    expect(renderTemplate('{{x}} and {{x}}', { x: 'foo' })).toBe('foo and foo')
  })

  it('replaces multiple distinct variables in one pass', () => {
    const result = renderTemplate('{{a}} {{b}}', { a: 'hello', b: 'world' })
    expect(result).toBe('hello world')
  })

  it('leaves unknown {{unknownVar}} placeholders intact', () => {
    expect(renderTemplate('{{known}} {{unknown}}', { known: 'hi' })).toBe('hi {{unknown}}')
  })

  it('with empty vars object makes no replacements', () => {
    const input = 'no {{change}} here'
    expect(renderTemplate(input, {})).toBe('no {{change}} here')
  })

  it('handles special characters in values without unintended substitution', () => {
    const result = renderTemplate('{{val}}', { val: '$1 {{nested}} \\n' })
    expect(result).toBe('$1 {{nested}} \\n')
  })
})
