import type { DbColumn, FieldType, FieldValidation, UiComponent } from './types'
import type {
  RawField,
  RawTextField,
  RawTextRichField,
  RawIntegerField,
  RawFloatField,
  RawBooleanField,
  RawDateField,
  RawImageField,
  RawVideoField,
  RawFileField,
  RawEnumField,
  RawParagraphField,
  RawReferenceField,
} from '../parser/validators'

// ─── Build context and result ─────────────────────────────────────────────────

// Everything a field builder needs beyond the raw field itself.
// ownerTableName is required to name a many-to-many junction table.
export type FieldBuildContext = {
  ownerTableName: string
}

// The three parsed parts a builder produces for one field. The parser wraps this
// with name/label/field_type/required/nullable/order to form a ParsedField.
export type BuiltField = {
  validation: FieldValidation
  db_column: DbColumn | null
  ui_component: UiComponent
}

// A builder is a pure function from one raw field of a given type to its parts.
// Each entry is typed to its own raw variant — no defensive narrowing inside.
type RawByType = {
  'text/plain': RawTextField
  'text/rich': RawTextRichField
  integer: RawIntegerField
  float: RawFloatField
  boolean: RawBooleanField
  date: RawDateField
  image: RawImageField
  video: RawVideoField
  file: RawFileField
  enum: RawEnumField
  paragraph: RawParagraphField
  reference: RawReferenceField
}

export type FieldBuilder<T extends FieldType> = (
  raw: RawByType[T],
  ctx: FieldBuildContext
) => BuiltField

export type FieldTypeRegistry = { [T in FieldType]: FieldBuilder<T> }

// The discriminant-erased shape used at the single dispatch site. The registry is
// keyed by the same field type the raw field carries, so the lookup is sound by
// construction even though TypeScript cannot correlate the two across the union.
export type AnyFieldBuilder = (raw: RawField, ctx: FieldBuildContext) => BuiltField

// ─── Shared naming helper ─────────────────────────────────────────────────────

// "content--blog_post" → "content_blog_post". Used by the reference builder for
// the FK / junction target table, and by the per-schema-type parsers for their
// own table names.
export function machineNameToTableName(machineName: string): string {
  return machineName.replace('--', '_')
}

// ─── Media mime constants ─────────────────────────────────────────────────────

// Specific types for server-side validation (FieldValidation.allowed_mime_types).
const MEDIA_ALLOWED_MIME: Record<'image' | 'video' | 'file', string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  file: ['application/pdf'],
}

// Wildcards for the HTML <input accept> attribute (UiComponent.accepted_mime_types).
const MEDIA_UI_MIME: Record<'image' | 'video' | 'file', string[]> = {
  image: ['image/*'],
  video: ['video/*'],
  file: ['application/pdf'],
}

// "2MB" → 2097152, "512KB" → 524288. Returns 0 for unrecognised input.
function parseMaxSize(str: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i.exec(str)
  if (!m) return 0
  const value = parseFloat(m[1]!)
  switch (m[2]!.toUpperCase()) {
    case 'B':  return Math.round(value)
    case 'KB': return Math.round(value * 1_024)
    case 'MB': return Math.round(value * 1_048_576)
    case 'GB': return Math.round(value * 1_073_741_824)
    default:   return 0
  }
}

// Shared builder for the three media field types — identical but for mime lists.
function buildMediaField(raw: RawImageField | RawVideoField | RawFileField): BuiltField {
  const mediaType = raw.type
  const maxSizeBytes = raw.max_size ? parseMaxSize(raw.max_size) : undefined
  return {
    validation: {
      required: raw.required,
      ...(maxSizeBytes !== undefined && { max_size: maxSizeBytes }),
      allowed_mime_types: MEDIA_ALLOWED_MIME[mediaType],
    },
    db_column: {
      column_name: raw.name,
      column_type: 'uuid',
      nullable: !raw.required,
      foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
    },
    ui_component: {
      component: 'file-upload',
      accepted_mime_types: MEDIA_UI_MIME[mediaType],
    },
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────
//
// One builder per field type. Each turns a single authored field into its
// { validation, db_column, ui_component } parts. The parser dispatches here
// rather than branching per type; adding a field type means adding one entry.

export const fieldTypeRegistry: FieldTypeRegistry = {
  // ── Primitives ──────────────────────────────────────────────────────────────

  'text/plain': (raw) => ({
    validation: {
      required: raw.required,
      ...(raw.limit !== undefined && { limit: raw.limit }),
      ...(raw.pattern !== undefined && { pattern: raw.pattern }),
    },
    db_column: { column_name: raw.name, column_type: 'varchar', nullable: !raw.required },
    ui_component: { component: 'text-input' },
  }),

  'text/rich': (raw) => ({
    validation: { required: raw.required },
    db_column: { column_name: raw.name, column_type: 'text', nullable: !raw.required },
    ui_component: { component: 'rich-text-editor' },
  }),

  integer: (raw) => ({
    validation: {
      required: raw.required,
      ...(raw.min !== undefined && { min: raw.min }),
      ...(raw.max !== undefined && { max: raw.max }),
    },
    db_column: { column_name: raw.name, column_type: 'integer', nullable: !raw.required },
    ui_component: { component: 'number-input', step: 1 },
  }),

  float: (raw) => ({
    validation: {
      required: raw.required,
      ...(raw.min !== undefined && { min: raw.min }),
      ...(raw.max !== undefined && { max: raw.max }),
    },
    db_column: { column_name: raw.name, column_type: 'decimal', nullable: !raw.required },
    ui_component: { component: 'number-input', step: 0.01 },
  }),

  // Boolean columns are always NOT NULL — false is the natural empty value, not NULL.
  boolean: (raw) => ({
    validation: { required: raw.required },
    db_column: { column_name: raw.name, column_type: 'boolean', nullable: false },
    ui_component: { component: 'checkbox' },
  }),

  date: (raw) => ({
    validation: { required: raw.required },
    db_column: { column_name: raw.name, column_type: 'timestamp', nullable: !raw.required },
    ui_component: { component: 'date-picker' },
  }),

  // ── Media — FK → media.id, SET NULL on delete ───────────────────────────────

  image: (raw) => buildMediaField(raw),
  video: (raw) => buildMediaField(raw),
  file: (raw) => buildMediaField(raw),

  // ── Enum — varchar + check constraint ───────────────────────────────────────
  //
  // Inline enum: values are present on the field and fully resolved here.
  // Ref enum: values live in another schema not yet available, so allowed_values
  // and check_constraint stay empty and enum_ref is stashed in ui_component for
  // resolveEnumReferences() to fill once the full registry is assembled.
  enum: (raw) => {
    const allowedValues = raw.values ?? []
    return {
      validation: { required: raw.required, allowed_values: allowedValues },
      db_column: {
        column_name: raw.name,
        column_type: 'varchar',
        nullable: !raw.required,
        check_constraint: allowedValues,
      },
      ui_component: {
        component: 'select',
        options: allowedValues,
        ...(raw.ref !== undefined && { enum_ref: raw.ref }),
      },
    }
  },

  // ── Paragraph — no column on the owning table ───────────────────────────────
  // The association lives on the paragraph table via parent_id/parent_type/
  // parent_field/order system fields.
  paragraph: (raw) => ({
    validation: {
      required: raw.required,
      ...(raw.max !== undefined && { max_items: raw.max }),
    },
    db_column: null,
    ui_component: {
      component: 'paragraph-embed',
      ref: raw.ref,
      rel: raw.rel,
      ...(raw.max !== undefined && { max: raw.max }),
    },
  }),

  // ── Reference — FK column, or a junction table for many-to-many ─────────────
  reference: (raw, ctx) => {
    const targetTableName = machineNameToTableName(raw.target)
    const validation: FieldValidation = {
      required: raw.required,
      ...(raw.max !== undefined && { max_items: raw.max }),
    }

    const db_column: DbColumn =
      raw.rel === 'many-to-many'
        ? {
            // No FK column — the junction table owns the association.
            column_name: '',
            column_type: 'uuid',
            nullable: !raw.required,
            junction: {
              table_name: `junction_${ctx.ownerTableName}_${raw.name}`,
              left_column: 'left_id',
              right_column: 'right_id',
              right_table: targetTableName,
              order_column: false,
            },
          }
        : {
            // FK column on the owning table. References are independent → SET NULL.
            column_name: raw.name,
            column_type: 'uuid',
            nullable: !raw.required,
            foreign_key: { table: targetTableName, column: 'id', on_delete: 'SET NULL' },
          }

    return {
      validation,
      db_column,
      ui_component: { component: 'typeahead-select', ref: raw.target, rel: raw.rel },
    }
  },
}
