import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLString,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLFloat,
  type GraphQLInputType,
} from 'graphql'
import type {
  ParsedContentType,
  ParsedTaxonomyType,
  FilterValue,
  FilterOperator,
  FieldType,
} from '@bobbykim/manguito-cms-core'
import { graphqlTypeName, buildFieldNameMap } from './naming.js'
import { scalarOutputType } from './type-mapping.js'
import { DateTimeScalar } from './scalars.js'

export const SortOrderEnum = new GraphQLEnumType({
  name: 'SortOrder',
  values: { ASC: { value: 'asc' }, DESC: { value: 'desc' } },
})

// Only these system fields are sortable (mirrors the REST SORTABLE_FIELDS).
const SORTABLE: Array<{ gql: string; column: string }> = [
  { gql: 'title', column: 'title' },
  { gql: 'createdAt', column: 'created_at' },
  { gql: 'updatedAt', column: 'updated_at' },
]

export function buildSortFieldEnum(typeName: string): GraphQLEnumType {
  return new GraphQLEnumType({
    name: `${typeName}SortField`,
    values: Object.fromEntries(SORTABLE.map((s) => [s.gql, { value: s.column }])),
  })
}

// A comparable filter input (eq/in/gt/gte/lt/lte) for a given scalar input type.
function comparableFilterInput(name: string, scalar: GraphQLInputType): GraphQLInputObjectType {
  return new GraphQLInputObjectType({
    name,
    fields: {
      eq: { type: scalar },
      in: { type: new GraphQLList(new GraphQLNonNull(scalar)) },
      gt: { type: scalar },
      gte: { type: scalar },
      lt: { type: scalar },
      lte: { type: scalar },
    },
  })
}

function equalityFilterInput(name: string, scalar: GraphQLInputType): GraphQLInputObjectType {
  return new GraphQLInputObjectType({
    name,
    fields: {
      eq: { type: scalar },
      in: { type: new GraphQLList(new GraphQLNonNull(scalar)) },
    },
  })
}

// Shared per-scalar filter inputs (built once).
const StringFilter = equalityFilterInput('StringFilter', GraphQLString)
const BooleanFilter = new GraphQLInputObjectType({
  name: 'BooleanFilter',
  fields: { eq: { type: GraphQLBoolean } },
})
const DateTimeFilter = comparableFilterInput('DateTimeFilter', DateTimeScalar)
const IDFilter = equalityFilterInput('IDFilter', GraphQLString)
const IntFilter = comparableFilterInput('IntFilter', GraphQLInt)
const FloatFilter = comparableFilterInput('FloatFilter', GraphQLFloat)

// Choose a filter input for a field based on its scalar output type.
function filterInputForField(fieldType: FieldType): GraphQLInputObjectType | null {
  const scalar = scalarOutputType(fieldType)
  if (fieldType === 'boolean') return BooleanFilter
  if (fieldType === 'date') return DateTimeFilter
  if (fieldType === 'integer') return IntFilter
  if (fieldType === 'float') return FloatFilter
  if (fieldType === 'reference') return IDFilter
  if (scalar === null) return null // only 'enum' reaches here — not filterable via a scalar input
  return StringFilter
}

// Build the <Type>Filter input. Programmatic fields are excluded (no column).
export function buildFilterInputType(
  type: ParsedContentType | ParsedTaxonomyType
): GraphQLInputObjectType | null {
  const fields: Record<string, { type: GraphQLInputObjectType }> = {}

  // System fields that are filterable columns.
  fields['id'] = { type: IDFilter }
  fields['published'] = { type: BooleanFilter }
  fields['createdAt'] = { type: DateTimeFilter }
  fields['updatedAt'] = { type: DateTimeFilter }
  if (type.schema_type === 'content-type') fields['slug'] = { type: StringFilter }

  for (const f of type.fields) {
    if (f.field_type === 'programmatic' || f.field_type === 'paragraph') continue
    if (f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file') continue
    const input = filterInputForField(f.field_type)
    if (input) fields[buildFieldNameMap([f.name]).toGraphql(f.name)] = { type: input }
  }

  if (Object.keys(fields).length === 0) return null
  return new GraphQLInputObjectType({ name: `${graphqlTypeName(type.name)}Filter`, fields })
}

// Convert a GraphQL filter argument into the repository's filters map, keyed by
// snake_case column. eq → scalar, in → array (OR/IN), gt/gte/lt/lte → operator.
export function translateFilters(
  input: Record<string, unknown> | undefined,
  nameMap: { toSchema(g: string): string }
): Record<string, FilterValue> {
  const out: Record<string, FilterValue> = {}
  if (!input) return out

  for (const [gqlField, raw] of Object.entries(input)) {
    if (raw === null || typeof raw !== 'object') continue
    const column = nameMap.toSchema(gqlField)
    const spec = raw as Record<string, unknown>

    // eq/in take priority over range operators (gt/gte/lt/lte) when a client sends
    // both in one field filter — the range operators are silently dropped.
    if (spec['eq'] !== undefined) {
      out[column] = spec['eq'] as FilterValue
    } else if (Array.isArray(spec['in'])) {
      out[column] = spec['in'] as FilterValue
    } else {
      const op: FilterOperator = {}
      for (const k of ['gt', 'gte', 'lt', 'lte'] as const) {
        if (spec[k] !== undefined) op[k] = spec[k] as number | string
      }
      if (Object.keys(op).length > 0) out[column] = op
    }
  }
  return out
}
