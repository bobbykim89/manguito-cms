import {
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  type GraphQLScalarType,
} from 'graphql'
import type { FieldType } from '@bobbykim/manguito-cms-core'
import { DateTimeScalar, JSONScalar } from './scalars.js'

// Scalar output type for a field. Relation/enum fields return null — schema.ts
// resolves those against its type caches.
export function scalarOutputType(fieldType: FieldType): GraphQLScalarType | null {
  switch (fieldType) {
    case 'text/plain':
    case 'text/rich':
      return GraphQLString
    case 'integer':
      return GraphQLInt
    case 'float':
      return GraphQLFloat
    case 'boolean':
      return GraphQLBoolean
    case 'date':
      return DateTimeScalar
    case 'programmatic':
      return JSONScalar
    default:
      return null
  }
}
