import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLEnumType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLID,
  GraphQLString,
  GraphQLInt,
  GraphQLBoolean,
  type GraphQLFieldConfig,
  type GraphQLOutputType,
  type GraphQLFieldConfigMap,
} from 'graphql'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
  ParsedParagraphType,
  ParsedField,
  ParsedEnumType,
} from '@bobbykim/manguito-cms-core'
import type { GraphQLContext } from './context.js'
import type { FieldKeyMap } from '../field-keys.js'
import type { VersionView, ViewField } from './version-view.js'
import { DateTimeScalar } from './scalars.js'
import { scalarOutputType } from './type-mapping.js'
import {
  graphqlTypeName,
  singleQueryName,
  collectionQueryName,
  toCamelCase,
  isValidGraphQLName,
  buildFieldNameMap,
} from './naming.js'
import { SortOrderEnum, buildSortFieldEnum, buildFilterInputType } from './filters.js'
import {
  scalarFieldResolver,
  relationFieldResolver,
  programmaticFieldResolver,
  collectionResolver,
  singleBySlugResolver,
  singletonResolver,
  taxonomySingleResolver,
} from './resolvers.js'

const PAGE_META = new GraphQLObjectType({
  name: 'PageMeta',
  fields: {
    total: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.total },
    page: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.page },
    perPage: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.per_page },
    totalPages: { type: new GraphQLNonNull(GraphQLInt), resolve: (m) => m.total_pages },
    hasNext: { type: new GraphQLNonNull(GraphQLBoolean), resolve: (m) => m.has_next },
    hasPrev: { type: new GraphQLNonNull(GraphQLBoolean), resolve: (m) => m.has_prev },
  },
})

const MEDIA = new GraphQLObjectType({
  name: 'Media',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID), resolve: (m) => m.id },
    type: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.type },
    url: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.url },
    mimeType: { type: new GraphQLNonNull(GraphQLString), resolve: (m) => m.mime_type },
    alt: { type: GraphQLString, resolve: (m) => m.alt },
    fileSize: { type: GraphQLInt, resolve: (m) => m.file_size },
    width: { type: GraphQLInt, resolve: (m) => m.width },
    height: { type: GraphQLInt, resolve: (m) => m.height },
    duration: { type: GraphQLInt, resolve: (m) => m.duration },
  },
})

export function buildGraphQLSchema(
  registry: SchemaRegistry,
  fieldKeyMaps: Record<string, FieldKeyMap> = {},
  view?: VersionView,
  // The maps a programmatic resolver's record is built with: current's, on
  // every version. Defaults to `fieldKeyMaps`, which is right when they ARE
  // current's (no view, or the current version's own endpoint).
  programmaticKeyMaps: Record<string, FieldKeyMap> = fieldKeyMaps
): GraphQLSchema {
  const objectTypes = new Map<string, GraphQLObjectType>() // machineName → type
  const enumTypes = new Map<string, GraphQLEnumType>() // enum machineName → type (only when valid)

  // Enum types (only when every value is a valid GraphQL identifier).
  for (const [name, enumType] of Object.entries(registry.enum_types) as [string, ParsedEnumType][]) {
    if (enumType.values.every(isValidGraphQLName)) {
      enumTypes.set(
        name,
        new GraphQLEnumType({
          name: graphqlTypeName(name),
          values: Object.fromEntries(enumType.values.map((v) => [v, { value: v }])),
        })
      )
    } else {
      process.stderr.write(
        `⚠ enum '${name}' has values that aren't valid GraphQL identifiers; exposing as String\n`
      )
    }
  }

  // Output type for one field (scalar, enum, relation, media, programmatic).
  function outputTypeForField(field: ParsedField, required: boolean): GraphQLOutputType {
    const scalar = scalarOutputType(field.field_type)
    if (scalar) return required ? new GraphQLNonNull(scalar) : scalar

    if (field.field_type === 'enum') {
      const ref = field.ui_component.component === 'select' ? field.ui_component.enum_ref : undefined
      const et = ref ? enumTypes.get(ref) : undefined
      const t = et ?? GraphQLString
      return required ? new GraphQLNonNull(t) : t
    }

    if (field.field_type === 'image' || field.field_type === 'video' || field.field_type === 'file') {
      return MEDIA
    }

    if (field.field_type === 'paragraph') {
      const ref = field.ui_component.component === 'paragraph-embed' ? field.ui_component.ref : undefined
      const target = ref ? objectTypes.get(ref) : undefined
      if (ref && !target) {
        process.stderr.write(
          `⚠ paragraph field '${field.name}' targets unknown paragraph type '${ref}'; exposing as Media\n`
        )
      }
      return new GraphQLList(new GraphQLNonNull(target ?? MEDIA))
    }

    if (field.field_type === 'reference') {
      const ref = field.ui_component.component === 'typeahead-select' ? field.ui_component.ref : undefined
      const target = ref ? objectTypes.get(ref) : undefined
      if (ref && !target) {
        process.stderr.write(`⚠ reference field '${field.name}' targets unknown type '${ref}'; exposing as Media\n`)
      }
      const rel = field.ui_component.component === 'typeahead-select' ? field.ui_component.rel : undefined
      const isMany = rel === 'many-to-many' || rel === 'one-to-many'
      const t = (target ?? MEDIA) as GraphQLObjectType
      return isMany ? new GraphQLList(new GraphQLNonNull(t)) : t
    }

    return GraphQLString
  }

  /**
   * A type's fields minus its tombstones.
   *
   * A tombstone (`removed: true`) is column-backed — the parser keeps its
   * column alive for older live versions — but the version being served must
   * never expose it. REST drops it via the FieldKeyMap's drop-set, which
   * `remap` applies; GraphQL resolves per field by column through
   * `resolveFieldValue` and never touches that map, so the exclusion has to
   * happen where the schema is BUILT. A field absent from the schema is a
   * validation error, so the retained value cannot reach a response at all.
   */
  function exposedFields(type: { fields: ParsedField[] }): ParsedField[] {
    return type.fields.filter((f) => f.removed !== true)
  }

  /**
   * The fields one schema exposes for a type, as ViewFields. With a view, the
   * served version's own list; without one, the registry's minus tombstones.
   */
  function viewFieldsFor(machineName: string, type: { fields: ParsedField[] }): ViewField[] {
    return (
      view?.[machineName]?.fields ??
      exposedFields(type).map((f) => ({ field: f, exposedAs: f.name, required: f.required }))
    )
  }

  // Build the object type for a content/taxonomy/paragraph type. Fields are a
  // thunk so relations can reference types created later (circular graphs).
  function buildObjectType(
    machineName: string,
    type: ParsedContentType | ParsedTaxonomyType | ParsedParagraphType
  ): GraphQLObjectType {
    const visible = viewFieldsFor(machineName, type)

    // Every live media field the type has NOW, by registry name. That is the
    // key ctx.loaders.load looks a field up by. The set is current's, not this
    // version's visible one: the programmatic record speaks current's labels,
    // and REST resolves every media field in the registry for it too.
    // Tombstones are excluded; current's map drops their column regardless.
    const mediaFieldNames = type.fields
      .filter(
        (f) =>
          f.removed !== true &&
          (f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file')
      )
      .map((f) => f.name)

    return new GraphQLObjectType({
      name: graphqlTypeName(machineName),
      fields: () => {
        const fields: GraphQLFieldConfigMap<Record<string, unknown>, GraphQLContext> = {}
        // System fields.
        fields['id'] = { type: new GraphQLNonNull(GraphQLID), resolve: (p) => p['id'] }
        if (type.schema_type !== 'paragraph-type') {
          fields['published'] = { type: new GraphQLNonNull(GraphQLBoolean), resolve: (p) => p['published'] }
        }
        if (type.schema_type === 'content-type') {
          fields['slug'] = { type: new GraphQLNonNull(GraphQLString), resolve: (p) => p['slug'] }
        }
        fields['createdAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['created_at'] }
        fields['updatedAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['updated_at'] }

        for (const vf of visible) {
          const field = vf.field
          const gqlName = toCamelCase(vf.exposedAs)
          const outType = outputTypeForField(field, vf.required)
          let resolve: GraphQLFieldConfig<Record<string, unknown>, GraphQLContext>['resolve']
          if (field.field_type === 'programmatic') {
            resolve = programmaticFieldResolver(machineName, field.name, mediaFieldNames, programmaticKeyMaps[machineName])
          } else if (
            field.field_type === 'reference' ||
            field.field_type === 'paragraph' ||
            field.field_type === 'image' ||
            field.field_type === 'video' ||
            field.field_type === 'file'
          ) {
            resolve = relationFieldResolver(machineName, field.name)
          } else {
            resolve = scalarFieldResolver(field, vf.fallback)
          }
          fields[gqlName] = {
            type: outType,
            resolve,
            // Conditional spread, not `deprecationReason: vf.deprecationReason`
            // — exactOptionalPropertyTypes forbids present-and-undefined.
            ...(vf.deprecationReason !== undefined && { deprecationReason: vf.deprecationReason }),
          }
        }
        return fields
      },
    })
  }

  // Pass 1: create every object type (empty-safe thunks resolve later).
  // Track GraphQL type name → machine name so two schemas that collapse to the
  // same GraphQL type name (e.g. content--author / taxonomy--author both → "Author")
  // fail loud here instead of surfacing as a cryptic GraphQLSchema build error.
  const typeNameOwners = new Map<string, string>() // graphqlTypeName → machineName
  function registerTypeName(machineName: string): void {
    const gqlName = graphqlTypeName(machineName)
    const owner = typeNameOwners.get(gqlName)
    if (owner !== undefined && owner !== machineName) {
      throw new Error(
        `GraphQL type name collision: '${gqlName}' is produced by both '${owner}' and '${machineName}'. ` +
          `Rename one schema's machine name segment so their GraphQL type names differ.`
      )
    }
    typeNameOwners.set(gqlName, machineName)
  }

  for (const [name, ct] of Object.entries(registry.content_types)) {
    registerTypeName(name)
    objectTypes.set(name, buildObjectType(name, ct))
  }
  for (const [name, tt] of Object.entries(registry.taxonomy_types)) {
    registerTypeName(name)
    objectTypes.set(name, buildObjectType(name, tt))
  }
  for (const [name, pt] of Object.entries(registry.paragraph_types)) {
    registerTypeName(name)
    objectTypes.set(name, buildObjectType(name, pt))
  }

  // Pass 2: build the root Query type.
  const queryFields: GraphQLFieldConfigMap<unknown, GraphQLContext> = {}

  for (const [name, ct] of Object.entries(registry.content_types) as [string, ParsedContentType][]) {
    const objType = objectTypes.get(name)!
    const visible = viewFieldsFor(name, ct)
    // The version's own labels: translateFilters maps a GraphQL name back to a
    // label, and columnFor then takes that label to the storage column.
    const nameMap = buildFieldNameMap(visible.map((v) => v.exposedAs))

    if (ct.only_one) {
      queryFields[singleQueryName(name)] = { type: objType, resolve: singletonResolver(name) }
      continue
    }

    const listType = new GraphQLObjectType({
      name: `${graphqlTypeName(name)}List`,
      fields: {
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(objType))), resolve: (r) => r.data },
        meta: { type: new GraphQLNonNull(PAGE_META), resolve: (r) => r.meta },
      },
    })
    const filterType = buildFilterInputType(ct, visible)

    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: {
        page: { type: GraphQLInt },
        perPage: { type: GraphQLInt },
        sortBy: { type: buildSortFieldEnum(graphqlTypeName(name), fieldKeyMaps[name]) },
        sortOrder: { type: SortOrderEnum },
        ...(filterType ? { filter: { type: filterType } } : {}),
      },
      resolve: collectionResolver(name, nameMap, fieldKeyMaps[name]),
    }
    queryFields[singleQueryName(name)] = {
      type: objType,
      args: { slug: { type: new GraphQLNonNull(GraphQLString) } },
      resolve: singleBySlugResolver(name),
    }
  }

  for (const [name, tt] of Object.entries(registry.taxonomy_types) as [string, ParsedTaxonomyType][]) {
    const objType = objectTypes.get(name)!
    const listType = new GraphQLObjectType({
      name: `${graphqlTypeName(name)}List`,
      fields: {
        data: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(objType))), resolve: (r) => r.data },
        meta: { type: new GraphQLNonNull(PAGE_META), resolve: (r) => r.meta },
      },
    })
    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: { page: { type: GraphQLInt }, perPage: { type: GraphQLInt } },
      resolve: collectionResolver(
        name,
        buildFieldNameMap(viewFieldsFor(name, tt).map((v) => v.exposedAs)),
        fieldKeyMaps[name]
      ),
    }
    queryFields[singleQueryName(name)] = {
      type: objType,
      args: { id: { type: new GraphQLNonNull(GraphQLID) } },
      resolve: taxonomySingleResolver(name),
    }
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
  })
}
