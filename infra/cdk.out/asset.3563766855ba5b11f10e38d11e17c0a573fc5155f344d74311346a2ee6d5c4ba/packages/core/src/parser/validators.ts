import { z } from 'zod'

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Snake-case identifier: starts with lowercase letter, then letters/digits/underscores.
const snakeCaseName = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'Must be snake_case (e.g. "blog_post")')

// Human-readable file size strings as authored in schema files.
// Normalisation to bytes happens in the parser, not here.
const maxSizeString = z
  .string()
  .regex(
    /^\d+(\.\d+)?\s*(B|KB|MB|GB)$/i,
    'Must be a file size string like "512KB" or "2MB"'
  )

// ─── Machine name validators ──────────────────────────────────────────────────

const contentMachineName = z
  .string()
  .regex(
    /^content--[a-z][a-z0-9_]*$/,
    'Must match "content--<snake_case_name>" (e.g. "content--blog_post")'
  )

const paragraphMachineName = z
  .string()
  .regex(
    /^paragraph--[a-z][a-z0-9_]*$/,
    'Must match "paragraph--<snake_case_name>" (e.g. "paragraph--photo_card")'
  )

const taxonomyMachineName = z
  .string()
  .regex(
    /^taxonomy--[a-z][a-z0-9_]*$/,
    'Must match "taxonomy--<snake_case_name>" (e.g. "taxonomy--daily_post")'
  )

const enumMachineName = z
  .string()
  .regex(
    /^enum--[a-z][a-z0-9_]*$/,
    'Must match "enum--<snake_case_name>" (e.g. "enum--link_target")'
  )

// Reference target must be a content-type or taxonomy-type machine name.
const refTargetMachineName = z
  .string()
  .regex(
    /^(content|taxonomy)--[a-z][a-z0-9_]*$/,
    'Target must be a content-type or taxonomy-type machine name'
  )

// ─── Field base ───────────────────────────────────────────────────────────────

// Properties shared across every field type.
const RawFieldBase = z.object({
  name: snakeCaseName,
  label: z.string().min(1),
  required: z.boolean(),
})

// ─── Primitive field schemas ──────────────────────────────────────────────────

export const RawTextPlainFieldSchema = RawFieldBase.extend({
  type: z.literal('text/plain'),
  limit: z.number().int().positive().optional(),
  pattern: z.string().optional(),
})

export const RawTextRichFieldSchema = RawFieldBase.extend({
  type: z.literal('text/rich'),
})

export const RawIntegerFieldSchema = RawFieldBase.extend({
  type: z.literal('integer'),
  // min/max are value bounds — can be any integer, including negative.
  min: z.number().int().optional(),
  max: z.number().int().optional(),
})

export const RawFloatFieldSchema = RawFieldBase.extend({
  type: z.literal('float'),
  min: z.number().optional(),
  max: z.number().optional(),
})

export const RawBooleanFieldSchema = RawFieldBase.extend({
  type: z.literal('boolean'),
})

export const RawDateFieldSchema = RawFieldBase.extend({
  type: z.literal('date'),
})

// ─── Media field schemas ──────────────────────────────────────────────────────

export const RawImageFieldSchema = RawFieldBase.extend({
  type: z.literal('image'),
  max_size: maxSizeString.optional(),
  alt: z.boolean().optional(),
})

export const RawVideoFieldSchema = RawFieldBase.extend({
  type: z.literal('video'),
  max_size: maxSizeString.optional(),
  alt: z.boolean().optional(),
})

export const RawFileFieldSchema = RawFieldBase.extend({
  type: z.literal('file'),
  max_size: maxSizeString.optional(),
  alt: z.boolean().optional(),
})

// ─── Enum field schema ────────────────────────────────────────────────────────

// Either ref (standalone enum) or values (inline enum) must be present — not both,
// not neither. The .refine() below enforces the XOR constraint.
//
// Note: .refine() promotes this schema from ZodObject to ZodEffects, which means
// it cannot participate in z.discriminatedUnion(). See RawFieldSchema below.
export const RawEnumFieldSchema = RawFieldBase.extend({
  type: z.literal('enum'),
  ref: enumMachineName.optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
}).refine(
  (d) => (d.ref !== undefined) !== (d.values !== undefined),
  { message: 'Enum field must have either ref or values — not both, not neither' }
)

// ─── Relation field schemas ───────────────────────────────────────────────────

// Paragraph: rel is restricted to one-to-one and one-to-many.
// many-to-many is not supported for paragraphs (polymorphic parent association).
export const RawParagraphFieldSchema = RawFieldBase.extend({
  type: z.literal('paragraph'),
  ref: paragraphMachineName,
  rel: z.enum(['one-to-one', 'one-to-many']),
  max: z.number().int().positive().optional(),
})

// Reference: supports all three relation types.
// target must be a content-type or taxonomy-type.
export const RawReferenceFieldSchema = RawFieldBase.extend({
  type: z.literal('reference'),
  target: refTargetMachineName,
  rel: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  max: z.number().int().positive().optional(),
})

// ─── Field union ──────────────────────────────────────────────────────────────

// The 11 non-enum field types form a proper discriminated union on 'type'.
// RawEnumFieldSchema is excluded here because .refine() makes it ZodEffects,
// which z.discriminatedUnion() does not accept.
const RawNonEnumFieldSchema = z.discriminatedUnion('type', [
  RawTextPlainFieldSchema,
  RawTextRichFieldSchema,
  RawIntegerFieldSchema,
  RawFloatFieldSchema,
  RawBooleanFieldSchema,
  RawDateFieldSchema,
  RawImageFieldSchema,
  RawVideoFieldSchema,
  RawFileFieldSchema,
  RawParagraphFieldSchema,
  RawReferenceFieldSchema,
])

// Complete field union. z.union() tries RawNonEnumFieldSchema first via the
// discriminant, then falls back to RawEnumFieldSchema for type === 'enum'.
export const RawFieldSchema = z.union([RawNonEnumFieldSchema, RawEnumFieldSchema])

// ─── Tab schema (content types only) ─────────────────────────────────────────

// Tabs are cosmetic wrappers for content type fields. The parser strips them
// to produce a flat fields array; tab structure is preserved in UiMeta.
const RawTabSchema = z.object({
  tab: z.object({
    name: snakeCaseName,
    label: z.string().min(1),
    fields: z.array(RawFieldSchema).min(1),
  }),
})

// ─── Schema file validators ───────────────────────────────────────────────────

// Content type: fields are wrapped in tabs. At least one tab required.
export const ContentTypeRawSchema = z.object({
  name: contentMachineName,
  label: z.string().min(1),
  type: z.literal('content-type'),
  default_base_path: z.string().min(1),
  only_one: z.boolean(),
  fields: z.array(RawTabSchema).min(1),
})

// Paragraph type: flat fields array. No tabs.
// Empty fields array is valid — system fields (id, parent_id, etc.) are always injected.
export const ParagraphTypeRawSchema = z.object({
  name: paragraphMachineName,
  label: z.string().min(1),
  type: z.literal('paragraph-type'),
  fields: z.array(RawFieldSchema),
})

// Taxonomy type: flat fields array. No tabs.
// Empty fields array is valid — system fields are always injected.
export const TaxonomyTypeRawSchema = z.object({
  name: taxonomyMachineName,
  label: z.string().min(1),
  type: z.literal('taxonomy-type'),
  fields: z.array(RawFieldSchema),
})

// Enum type: no fields — just a name and an array of string values.
export const EnumTypeRawSchema = z.object({
  name: enumMachineName,
  label: z.string().min(1),
  type: z.literal('enum-type'),
  values: z.array(z.string().min(1)).min(1),
})

// routes.json: defines the valid base paths that content types can reference.
export const RoutesFileSchema = z.object({
  base_paths: z
    .array(
      z.object({
        name: snakeCaseName,
        path: z.string().regex(/^\//, 'Path must start with /'),
      })
    )
    .min(1),
})

// ─── Inferred types ───────────────────────────────────────────────────────────

export type RawContentType = z.infer<typeof ContentTypeRawSchema>
export type RawParagraphType = z.infer<typeof ParagraphTypeRawSchema>
export type RawTaxonomyType = z.infer<typeof TaxonomyTypeRawSchema>
export type RawEnumType = z.infer<typeof EnumTypeRawSchema>
export type RawRoutesFile = z.infer<typeof RoutesFileSchema>

export type RawTextField = z.infer<typeof RawTextPlainFieldSchema>
export type RawTextRichField = z.infer<typeof RawTextRichFieldSchema>
export type RawIntegerField = z.infer<typeof RawIntegerFieldSchema>
export type RawFloatField = z.infer<typeof RawFloatFieldSchema>
export type RawBooleanField = z.infer<typeof RawBooleanFieldSchema>
export type RawDateField = z.infer<typeof RawDateFieldSchema>
export type RawImageField = z.infer<typeof RawImageFieldSchema>
export type RawVideoField = z.infer<typeof RawVideoFieldSchema>
export type RawFileField = z.infer<typeof RawFileFieldSchema>
export type RawEnumField = z.infer<typeof RawEnumFieldSchema>
export type RawParagraphField = z.infer<typeof RawParagraphFieldSchema>
export type RawReferenceField = z.infer<typeof RawReferenceFieldSchema>
export type RawField = z.infer<typeof RawFieldSchema>
