import { describe, it, expect } from 'vitest'
import {
  schemaSegment,
  toPascalCase,
  toCamelCase,
  pluralize,
  isValidGraphQLName,
  graphqlTypeName,
  singleQueryName,
  collectionQueryName,
  buildFieldNameMap,
} from '../naming'

describe('naming', () => {
  it('extracts the machine-name segment after "--"', () => {
    expect(schemaSegment('content--blog_post')).toBe('blog_post')
    expect(schemaSegment('category')).toBe('category')
  })

  it('converts snake_case to Pascal and camel case', () => {
    expect(toPascalCase('blog_post')).toBe('BlogPost')
    expect(toCamelCase('created_at')).toBe('createdAt')
    expect(toCamelCase('blog_post')).toBe('blogPost')
  })

  it('pluralizes common English forms', () => {
    expect(pluralize('blogPost')).toBe('blogPosts')
    expect(pluralize('category')).toBe('categories')
    expect(pluralize('box')).toBe('boxes')
    expect(pluralize('dish')).toBe('dishes')
  })

  it('validates GraphQL identifier names', () => {
    expect(isValidGraphQLName('draft')).toBe(true)
    expect(isValidGraphQLName('IN_PROGRESS')).toBe(true)
    expect(isValidGraphQLName('in-progress')).toBe(false)
    expect(isValidGraphQLName('2024')).toBe(false)
    expect(isValidGraphQLName('high priority')).toBe(false)
  })

  it('derives type and query names from a machine name', () => {
    expect(graphqlTypeName('content--blog_post')).toBe('BlogPost')
    expect(singleQueryName('content--blog_post')).toBe('blogPost')
    expect(collectionQueryName('content--blog_post')).toBe('blogPosts')
  })

  it('maps field names bidirectionally', () => {
    const m = buildFieldNameMap(['created_at', 'blog_title'])
    expect(m.toGraphql('created_at')).toBe('createdAt')
    expect(m.toSchema('createdAt')).toBe('created_at')
    expect(m.toSchema('blogTitle')).toBe('blog_title')
  })
})
