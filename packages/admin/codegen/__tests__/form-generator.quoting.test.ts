import { describe, it, expect } from 'vitest'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import type { ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'
import { generateFormComponent } from '../form-generator'

// #96: labels and enum options are free text. A YAML block scalar or a `\n` in
// JSON gives a line break. U+2028 is legal in a string literal, and stays exact.
const LABEL = `Line one\nLine two "quoted" & it's\u2028end \\ x`
const OPTIONS = [`say "hi"`, `it's\r\nhere`, 'plain']

const TAXO: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--tag',
  label: 'Tag',
  source_file: 'x.json',
  system_fields: [],
  fields: [
    { name: 'title', label: LABEL, field_type: 'text/plain', required: true, nullable: false, order: 0, validation: { required: true }, db_column: { column_name: 'title', column_type: 'varchar', nullable: false }, ui_component: { component: 'text-input' } },
    { name: 'status', label: 'Status', field_type: 'enum', required: true, nullable: false, order: 1, validation: { required: true, allowed_values: OPTIONS }, db_column: { column_name: 'status', column_type: 'varchar', nullable: false, check_constraint: OPTIONS }, ui_component: { component: 'select', options: OPTIONS } },
    { name: 'computed_one', label: LABEL, field_type: 'programmatic', required: false, nullable: true, order: 2, validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' } },
  ],
  db: { table_name: 'taxonomy_tag', junction_tables: [] },
  api: { collection_path: '/api/taxonomy/tag', item_path: '/api/taxonomy/tag/:id' },
}

type TemplateNode = { type: number; children?: TemplateNode[]; props?: Array<{ type: number; arg?: { content: string }; exp?: { content: string } }> }

// Each `:field` binding's expression, as Vue reads it after decoding the attribute.
function fieldBindings(sfc: string): Array<Record<string, unknown>> {
  const { descriptor, errors } = parse(sfc)
  expect(errors).toEqual([])
  const out: Array<Record<string, unknown>> = []
  const walk = (node: TemplateNode): void => {
    for (const p of node.props ?? []) {
      if (p.type === 7 && p.arg?.content === 'field') {
        out.push(new Function(`return (${p.exp!.content})`)() as Record<string, unknown>)
      }
    }
    node.children?.forEach(walk)
  }
  walk(descriptor.template!.ast as unknown as TemplateNode)
  return out
}

describe('generated forms quote labels and options safely', () => {
  it('compiles when a label or an option holds a line break or quotes', () => {
    // MUTATION: restore the old esc() (escapes only `\` and `'`). The raw line
    // break in the label then sits inside a quoted JS string and the template
    // fails to compile.
    const sfc = generateFormComponent(TAXO)
    const { descriptor } = parse(sfc)
    const r = compileTemplate({ source: descriptor.template!.content, filename: 'tag.vue', id: 'tag' })
    expect(r.errors).toEqual([])
  })

  it('keeps each label and option exact', () => {
    // MUTATION: drop escAttr around either :field binding (the input one, or
    // the computed-display one). The `"` in the label then ends the attribute
    // and the binding no longer evaluates to the label.
    const [title, status, computed] = fieldBindings(generateFormComponent(TAXO))
    expect(title!['label']).toBe(LABEL)
    expect(computed!['label']).toBe(LABEL)
    expect((status!['validation'] as { allowed_values: string[] }).allowed_values).toEqual(OPTIONS)
  })
})
