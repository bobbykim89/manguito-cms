// @bobbykim/manguito-cms-core
// Schema parser and field type registry — no runtime dependencies beyond Zod.

export type {
  SchemaFolders,
  SchemaConfig,
  ResolvedSchemaConfig,
  ProgrammaticConfig,
  ResolvedProgrammaticConfig,
  MigrationsConfig,
  ResolvedMigrationsConfig,
  MigrationResult,
  MigrationStatus,
  DbAdapter,
  PresignedOptions,
  PresignedResult,
  StorageAdapter,
  CorsConfig,
  ServerAdapter,
  ResolvedMediaConfig,
  APIAdapter,
  ResolvedRateLimitConfig,
  AdminAdapter,
  ManguitoConfig,
  ResolvedManguitoConfig,
} from './config/types.js'

export { defineConfig } from './config/defineConfig.js'

export type {
  DbColumnType,
  DbColumn,
  FieldValidation,
  FieldType,
  RelationType,
  UiComponent,
  ParsedField,
  SystemField,
} from './registry/types.js'

export type {
  ParsedSchemaBase,
  UiTab,
  UiMeta,
  JunctionTable,
  ContentDbMeta,
  ParagraphDbMeta,
  TaxonomyDbMeta,
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedEnumType,
  ParsedSchema,
  ParseResult,
} from './parser/parseSchema.js'

export type {
  ParsedBasePath,
  ParsedRoutes,
  ParsedRole,
  ParsedRoles,
  SchemaRegistry,
} from './parser/validate.js'

export {
  buildSchemaRegistry,
  validateCrossReferences,
  parseRoutes,
} from './parser/validate.js'

export type {
  Result,
  ParseError,
  ParseErrorCode,
  SchemaFile,
  SchemaType,
} from './parser/loader.js'

export { walkSchemaDirectory, loadSchemaFile } from './parser/loader.js'

export { parseSchema } from './parser/parseSchema.js'

export { parseRoles } from './parser/parseRoles.js'

export type { ErrorCode } from './errors.js'

export type {
  PermissionTarget,
  PermissionAction,
  Permission,
  JWTPayload,
  User,
  FilterOperator,
  FilterValue,
  PaginatedResult,
  FindManyOptions,
  FindAllOptions,
  CreateInput,
  UpdateInput,
  ContentRepository,
  MediaItem,
  CreateMediaInput,
  MediaFindManyOptions,
  MediaRepository,
} from './types.js'

export { hashPassword, verifyPassword } from './auth.js'

export { programmaticField } from './programmatic/defineProgrammaticField.js'

export type {
  JsonValue,
  ResolverContext,
  Resolver,
  ProgrammaticFieldOptions,
  ProgrammaticFieldDefinition,
} from './programmatic/defineProgrammaticField.js'
