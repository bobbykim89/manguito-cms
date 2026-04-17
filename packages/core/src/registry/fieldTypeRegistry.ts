import type { DbColumn, FieldType, FieldValidation, UiComponent } from './types'

// ─── Registry Entry ───────────────────────────────────────────────────────────

// db_column is null for field types that produce no column on the owning table.
// Currently only 'paragraph' — its association is stored on the paragraph table
// via the parent_id / parent_type / parent_field system fields.
//
// For 'reference', the entry below is the FK template (one-to-one / one-to-many).
// The parser detects rel === 'many-to-many' and writes db_column.junction instead.
//
// ui_component values for 'enum', 'paragraph', and 'reference' are templates.
// Fields that require runtime values (ref, rel, options) are filled in by the
// parser from the specific field definition — empty string / empty array here
// acts as a clear sentinel that the parser must populate.

export type FieldTypeRegistryEntry = {
  db_column: DbColumn | null
  ui_component: UiComponent
  validation_defaults: Partial<FieldValidation>
}

export type FieldTypeRegistry = Record<FieldType, FieldTypeRegistryEntry>

// ─── Registry ─────────────────────────────────────────────────────────────────

export const fieldTypeRegistry: FieldTypeRegistry = {
  // ── Primitive fields ────────────────────────────────────────────────────────

  'text/plain': {
    db_column: {
      column_name: '',
      column_type: 'varchar',
      nullable: true,
    },
    ui_component: { component: 'text-input' },
    validation_defaults: {},
  },

  'text/rich': {
    db_column: {
      column_name: '',
      column_type: 'text',
      nullable: true,
    },
    ui_component: { component: 'rich-text-editor' },
    validation_defaults: {},
  },

  integer: {
    db_column: {
      column_name: '',
      column_type: 'integer',
      nullable: true,
    },
    ui_component: { component: 'number-input', step: 1 },
    validation_defaults: {},
  },

  float: {
    db_column: {
      column_name: '',
      column_type: 'decimal',
      nullable: true,
    },
    ui_component: { component: 'number-input', step: 0.01 },
    validation_defaults: {},
  },

  boolean: {
    // Boolean columns are always NOT NULL — false is the natural empty value, not NULL.
    db_column: {
      column_name: '',
      column_type: 'boolean',
      nullable: false,
    },
    ui_component: { component: 'checkbox' },
    validation_defaults: { required: false },
  },

  date: {
    db_column: {
      column_name: '',
      column_type: 'timestamp',
      nullable: true,
    },
    ui_component: { component: 'date-picker' },
    validation_defaults: {},
  },

  // ── Media fields — FK → media.id, SET NULL on delete ────────────────────────

  image: {
    db_column: {
      column_name: '',
      column_type: 'uuid',
      nullable: true,
      foreign_key: {
        table: 'media',
        column: 'id',
        on_delete: 'SET NULL',
      },
    },
    ui_component: {
      component: 'file-upload',
      accepted_mime_types: ['image/*'],
    },
    validation_defaults: {},
  },

  video: {
    db_column: {
      column_name: '',
      column_type: 'uuid',
      nullable: true,
      foreign_key: {
        table: 'media',
        column: 'id',
        on_delete: 'SET NULL',
      },
    },
    ui_component: {
      component: 'file-upload',
      accepted_mime_types: ['video/*'],
    },
    validation_defaults: {},
  },

  file: {
    db_column: {
      column_name: '',
      column_type: 'uuid',
      nullable: true,
      foreign_key: {
        table: 'media',
        column: 'id',
        on_delete: 'SET NULL',
      },
    },
    ui_component: {
      component: 'file-upload',
      accepted_mime_types: ['application/pdf'],
    },
    validation_defaults: {},
  },

  // ── Enum — varchar + check constraint ───────────────────────────────────────
  // check_constraint and options are empty here; the parser inlines allowed_values
  // from the resolved enum definition (standalone ref or inline values array).

  enum: {
    db_column: {
      column_name: '',
      column_type: 'varchar',
      nullable: true,
      check_constraint: [],
    },
    ui_component: {
      component: 'select',
      options: [],
    },
    validation_defaults: { allowed_values: [] },
  },

  // ── Paragraph — no column on the owning content table ───────────────────────
  // The association lives entirely on the paragraph table via system fields:
  //   parent_id (uuid), parent_type (varchar), parent_field (varchar), order (integer)
  // ref and rel are template sentinels; the parser populates them from the field def.

  paragraph: {
    db_column: null,
    ui_component: {
      component: 'paragraph-embed',
      ref: '',
      rel: 'one-to-many',
    },
    validation_defaults: {},
  },

  // ── Reference — FK template for one-to-one / one-to-many ────────────────────
  // For many-to-many the parser discards this template and writes db_column.junction.
  // foreign_key.table is empty here; the parser resolves it from the target schema's
  // table name at parse time. ref and rel are populated from the field definition.

  reference: {
    db_column: {
      column_name: '',
      column_type: 'uuid',
      nullable: true,
      foreign_key: {
        table: '',
        column: 'id',
        on_delete: 'SET NULL',
      },
    },
    ui_component: {
      component: 'typeahead-select',
      ref: '',
      rel: 'one-to-one',
    },
    validation_defaults: {},
  },
}
