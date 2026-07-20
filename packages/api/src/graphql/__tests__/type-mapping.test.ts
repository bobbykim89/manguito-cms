import { describe, it, expect } from 'vitest'
import { GraphQLString, GraphQLInt, GraphQLFloat, GraphQLBoolean } from 'graphql'
import { scalarOutputType } from '../type-mapping'
import { DateTimeScalar, JSONScalar } from '../scalars'

describe('scalarOutputType', () => {
  it('maps scalar field types', () => {
    expect(scalarOutputType('text/plain')).toBe(GraphQLString)
    expect(scalarOutputType('text/rich')).toBe(GraphQLString)
    expect(scalarOutputType('integer')).toBe(GraphQLInt)
    expect(scalarOutputType('float')).toBe(GraphQLFloat)
    expect(scalarOutputType('boolean')).toBe(GraphQLBoolean)
    expect(scalarOutputType('date')).toBe(DateTimeScalar)
    expect(scalarOutputType('programmatic')).toBe(JSONScalar)
  })

  it('returns null for relation and enum field types', () => {
    expect(scalarOutputType('enum')).toBeNull()
    expect(scalarOutputType('reference')).toBeNull()
    expect(scalarOutputType('paragraph')).toBeNull()
    expect(scalarOutputType('image')).toBeNull()
  })
})
