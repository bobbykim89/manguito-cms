import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ParsedSchema,
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedEnumType,
  ParsedRole,
  ParsedField,
  UiMeta,
  SystemField,
} from '@bobbykim/manguito-cms-core'

// Shape returned by GET /admin/api/schema — full ParsedField objects so the
// admin forms can render inputs and run client-side validation without extra
// round-trips to the server.
export type ApiSchemaResponse = {
  content_types: Array<{
    name: string
    label: string
    only_one: boolean
    ui: UiMeta
    system_fields: SystemField[]
    fields: ParsedField[]
  }>
  taxonomy_types: Array<{
    name: string
    label: string
    system_fields: SystemField[]
    fields: ParsedField[]
  }>
  paragraph_types: Array<{
    name: string
    label: string
    system_fields: SystemField[]
    fields: ParsedField[]
  }>
  enum_types: Array<{ name: string; label: string; values: string[] }>
}

export const useSchemaStore = defineStore('schema', () => {
  const contentTypes = ref<Record<string, ParsedContentType>>({})
  const taxonomyTypes = ref<Record<string, ParsedTaxonomyType>>({})
  const paragraphTypes = ref<Record<string, ParsedParagraphType>>({})
  const enumTypes = ref<Record<string, ParsedEnumType>>({})
  const roles = ref<ParsedRole[]>([])

  function setSchema(schema: ParsedSchema) {
    switch (schema.schema_type) {
      case 'content-type':
        contentTypes.value[schema.name] = schema
        break
      case 'taxonomy-type':
        taxonomyTypes.value[schema.name] = schema
        break
      case 'paragraph-type':
        paragraphTypes.value[schema.name] = schema
        break
      case 'enum-type':
        enumTypes.value[schema.name] = schema
        break
    }
  }

  function setRoles(newRoles: ParsedRole[]) {
    roles.value = newRoles
  }

  function setFromApiSchema(data: ApiSchemaResponse) {
    for (const ct of data.content_types) {
      contentTypes.value[ct.name] = {
        schema_type: 'content-type',
        name: ct.name,
        label: ct.label,
        only_one: ct.only_one,
        ui: ct.ui,
        system_fields: ct.system_fields,
        fields: ct.fields,
      } as unknown as ParsedContentType
    }
    for (const tt of data.taxonomy_types) {
      taxonomyTypes.value[tt.name] = {
        schema_type: 'taxonomy-type',
        name: tt.name,
        label: tt.label,
        system_fields: tt.system_fields,
        fields: tt.fields,
      } as unknown as ParsedTaxonomyType
    }
    for (const pt of data.paragraph_types) {
      paragraphTypes.value[pt.name] = {
        schema_type: 'paragraph-type',
        name: pt.name,
        label: pt.label,
        system_fields: pt.system_fields,
        fields: pt.fields,
      } as unknown as ParsedParagraphType
    }
    for (const et of data.enum_types) {
      enumTypes.value[et.name] = {
        schema_type: 'enum-type',
        name: et.name,
        label: et.label,
        values: et.values,
      } as unknown as ParsedEnumType
    }
  }

  function getContentType(name: string): ParsedContentType | undefined {
    return contentTypes.value[name]
  }

  function getRoleByName(name: string): ParsedRole | undefined {
    return roles.value.find(r => r.name === name)
  }

  return {
    contentTypes,
    taxonomyTypes,
    paragraphTypes,
    enumTypes,
    roles,
    setSchema,
    setRoles,
    setFromApiSchema,
    getContentType,
    getRoleByName,
  }
})
