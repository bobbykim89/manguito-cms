import { describe, it, expect } from 'vitest'
import { getNullableType, isListType, type GraphQLObjectType } from 'graphql'
import { buildGraphQLSchema } from '../schema'
import { graphqlTypeName, toCamelCase } from '../naming'
import { makeCardinalityFixture } from '../../__tests__/relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcgql')
const schema = buildGraphQLSchema(fx.registry)

function isList(machineName: string, fieldName: string): boolean {
  const type = schema.getType(graphqlTypeName(machineName)) as GraphQLObjectType | undefined
  if (!type) throw new Error(`no GraphQL type for ${machineName}`)
  const field = type.getFields()[toCamelCase(fieldName)]
  if (!field) throw new Error(`no field ${fieldName} on ${type.name}`)
  return isListType(getNullableType(field.type))
}

describe('GraphQL relation field types follow relationCardinality', () => {
  it('a one-to-one paragraph is a single object', () => {
    // MUTATION: keep `return new GraphQLList(...)` for every paragraph.
    expect(isList(fx.names.post, 'link')).toBe(false)
  })
  it('a nested one-to-one paragraph is a single object', () => {
    // MUTATION: shape only content types' fields, not paragraph types'.
    expect(isList(fx.names.card, 'card_link')).toBe(false)
  })
  it('a one-to-many paragraph is a list', () => {
    // MUTATION: make every paragraph single.
    expect(isList(fx.names.post, 'cards')).toBe(true)
  })
  it('a deprecated one-to-many reference is a single object, like its REST read', () => {
    // MUTATION: keep `isMany = rel === 'many-to-many' || rel === 'one-to-many'`.
    expect(isList(fx.names.post, 'category')).toBe(false)
  })
  it('a many-to-many reference is a list', () => {
    // MUTATION: make every reference single.
    expect(isList(fx.names.post, 'tags')).toBe(true)
  })
})
