import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ParsedSchema,
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedEnumType,
  ParsedRole,
} from '@bobbykim/manguito-cms-core'

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
    getContentType,
    getRoleByName,
  }
})
