// @bobbykim/manguito-cms-core
// Schema parser and field type registry — no runtime dependencies beyond Zod.

export type {
  SchemaFolders,
  SchemaConfig,
  ResolvedSchemaConfig,
  MigrationsConfig,
  ResolvedMigrationsConfig,
  MigrationResult,
  MigrationStatus,
  DbAdapter,
  UploadOptions,
  UploadResult,
  PresignedOptions,
  PresignedResult,
  StorageAdapter,
  CorsConfig,
  ServerAdapter,
  ResolvedMediaConfig,
  APIAdapter,
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

export type { ErrorCode } from './errors.js'

export type {
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
