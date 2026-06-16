// ─── DB Column ────────────────────────────────────────────────────────────────

export type DbColumnType =
  | 'uuid'
  | 'varchar'
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'timestamp'

export type DbColumn = {
  column_name: string
  column_type: DbColumnType
  nullable: boolean
  check_constraint?: string[]
  foreign_key?: {
    table: string
    column: string
    on_delete: 'CASCADE' | 'SET NULL' | 'RESTRICT'
  }
  junction?: {
    table_name: string
    left_column: string
    right_column: string
    right_table: string
    order_column: boolean
  }
}

// ─── Field Validation ─────────────────────────────────────────────────────────

export type FieldValidation = {
  required: boolean
  min?: number
  max?: number
  limit?: number
  max_size?: number
  pattern?: string
  max_items?: number
  allowed_values?: string[]
  allowed_mime_types?: string[]
}

// ─── UI Component ─────────────────────────────────────────────────────────────

export type RelationType = 'one-to-one' | 'one-to-many' | 'many-to-many'

export type UiComponent =
  | { component: 'text-input' }
  | { component: 'rich-text-editor' }
  | { component: 'number-input'; step: number }
  | { component: 'checkbox' }
  | { component: 'date-picker' }
  | { component: 'file-upload'; accepted_mime_types: string[] }
  | { component: 'select'; options: string[]; enum_ref?: string }
  | { component: 'typeahead-select'; ref: string; rel: RelationType }
  | { component: 'paragraph-embed'; ref: string; rel: RelationType; max?: number }

// ─── Field Type ───────────────────────────────────────────────────────────────

export type FieldType =
  | 'text/plain'
  | 'text/rich'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'image'
  | 'video'
  | 'file'
  | 'enum'
  | 'paragraph'
  | 'reference'

// ─── Parsed Field ─────────────────────────────────────────────────────────────

export type ParsedField = {
  name: string
  label: string
  field_type: FieldType
  required: boolean
  nullable: boolean
  order: number
  validation: FieldValidation
  // null for paragraph fields — no column on the owning table.
  // DB codegen checks field_type === 'paragraph' and skips column creation.
  db_column: DbColumn | null
  ui_component: UiComponent
}

// ─── System Field ─────────────────────────────────────────────────────────────

export type SystemField = {
  name: string
  db_type: 'uuid' | 'timestamp' | 'varchar' | 'boolean' | 'integer'
  primary_key?: boolean
  default?: string
  nullable: boolean
}
