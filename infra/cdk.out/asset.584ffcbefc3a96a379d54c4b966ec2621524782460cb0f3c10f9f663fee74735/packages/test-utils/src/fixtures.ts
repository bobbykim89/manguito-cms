import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedTaxonomyType,
  ParsedParagraphType,
  ParsedEnumType,
} from '@bobbykim/manguito-cms-core'

// ─── Schema fixtures ──────────────────────────────────────────────────────────

const articleSchema: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--article',
  label: 'Article',
  source_file: 'schemas/content-types/content--article.yaml',
  only_one: false,
  default_base_path: 'blog',
  system_fields: [
    { name: 'id',           db_type: 'uuid',      primary_key: true, default: 'gen_random_uuid()', nullable: false },
    { name: 'slug',         db_type: 'varchar',                                                     nullable: false },
    { name: 'base_path_id', db_type: 'uuid',                                                        nullable: false },
    { name: 'published',    db_type: 'boolean',                       default: 'false',              nullable: false },
    { name: 'created_at',   db_type: 'timestamp',                     default: 'now()',              nullable: false },
    { name: 'updated_at',   db_type: 'timestamp',                     default: 'now()',              nullable: false },
  ],
  fields: [
    {
      name: 'title', label: 'Title', field_type: 'text/plain',
      required: true, nullable: false, order: 0,
      validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'body', label: 'Body', field_type: 'text/rich',
      required: true, nullable: false, order: 1,
      validation: { required: true },
      db_column: { column_name: 'body', column_type: 'text', nullable: false },
      ui_component: { component: 'rich-text-editor' },
    },
    {
      name: 'cover', label: 'Cover', field_type: 'image',
      required: false, nullable: true, order: 2,
      validation: {
        required: false,
        allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'],
      },
      db_column: {
        column_name: 'cover', column_type: 'uuid', nullable: true,
        foreign_key: { table: 'media', column: 'id', on_delete: 'SET NULL' },
      },
      ui_component: { component: 'file-upload', accepted_mime_types: ['image/*'] },
    },
    {
      name: 'category', label: 'Category', field_type: 'reference',
      required: false, nullable: true, order: 3,
      validation: { required: false },
      db_column: {
        column_name: 'category', column_type: 'uuid', nullable: true,
        foreign_key: { table: 'taxonomy_category', column: 'id', on_delete: 'SET NULL' },
      },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-many' },
    },
    {
      name: 'published_at', label: 'Published At', field_type: 'date',
      required: false, nullable: true, order: 4,
      validation: { required: false },
      db_column: { column_name: 'published_at', column_type: 'timestamp', nullable: true },
      ui_component: { component: 'date-picker' },
    },
    {
      name: 'tags', label: 'Tags', field_type: 'reference',
      required: false, nullable: true, order: 5,
      validation: { required: false },
      db_column: {
        column_name: '', column_type: 'uuid', nullable: true,
        junction: {
          table_name: 'junction_content_article_tags',
          left_column: 'left_id',
          right_column: 'right_id',
          right_table: 'taxonomy_category',
          order_column: false,
        },
      },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'many-to-many' },
    },
    {
      name: 'priority', label: 'Priority', field_type: 'integer',
      required: false, nullable: true, order: 6,
      validation: { required: false },
      db_column: { column_name: 'priority', column_type: 'integer', nullable: true },
      ui_component: { component: 'number-input', step: 1 },
    },
  ],
  ui: {
    tabs: [
      {
        name: 'main',
        label: 'Main',
        fields: ['title', 'body', 'cover', 'category', 'published_at', 'tags', 'priority'],
      },
    ],
  },
  db: {
    table_name: 'content_article',
    junction_tables: [
      {
        table_name: 'junction_content_article_tags',
        left_column: 'left_id',
        right_column: 'right_id',
        right_table: 'taxonomy_category',
        order_column: false,
      },
    ],
  },
  api: {
    default_base_path: 'blog',
    http_methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    collection_path: '/api/article',
    item_path: '/api/article/:slug',
  },
}

const categorySchema: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--category',
  label: 'Category',
  source_file: 'schemas/taxonomy-types/taxonomy--category.yaml',
  system_fields: [
    { name: 'id',         db_type: 'uuid',      primary_key: true, default: 'gen_random_uuid()', nullable: false },
    { name: 'published',  db_type: 'boolean',                       default: 'false',              nullable: false },
    { name: 'created_at', db_type: 'timestamp',                     default: 'now()',              nullable: false },
    { name: 'updated_at', db_type: 'timestamp',                     default: 'now()',              nullable: false },
  ],
  fields: [
    {
      name: 'label', label: 'Label', field_type: 'text/plain',
      required: true, nullable: false, order: 0,
      validation: { required: true },
      db_column: { column_name: 'label', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: 'taxonomy_category' },
  api: {
    collection_path: '/api/taxonomy/category',
    item_path: '/api/taxonomy/category/:id',
  },
}

const pullQuoteSchema: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--pull_quote',
  label: 'Pull Quote',
  source_file: 'schemas/paragraph-types/paragraph--pull_quote.yaml',
  system_fields: [
    { name: 'id',           db_type: 'uuid',      primary_key: true, default: 'gen_random_uuid()', nullable: false },
    { name: 'parent_id',    db_type: 'uuid',                                                        nullable: false },
    { name: 'parent_type',  db_type: 'varchar',                                                     nullable: false },
    { name: 'parent_field', db_type: 'varchar',                                                     nullable: false },
    { name: 'order',        db_type: 'integer',                       default: '0',                 nullable: false },
    { name: 'created_at',   db_type: 'timestamp',                     default: 'now()',              nullable: false },
    { name: 'updated_at',   db_type: 'timestamp',                     default: 'now()',              nullable: false },
  ],
  fields: [
    {
      name: 'quote', label: 'Quote', field_type: 'text/plain',
      required: true, nullable: false, order: 0,
      validation: { required: true },
      db_column: { column_name: 'quote', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'attribution', label: 'Attribution', field_type: 'text/plain',
      required: false, nullable: true, order: 1,
      validation: { required: false },
      db_column: { column_name: 'attribution', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: 'paragraph_pull_quote' },
}

const articleStatusSchema: ParsedEnumType = {
  schema_type: 'enum-type',
  name: 'enum--article_status',
  label: 'Article Status',
  source_file: 'schemas/enum-types/enum--article_status.yaml',
  values: ['draft', 'review', 'published'],
}

export const testParsedSchema: SchemaRegistry = {
  routes: {
    base_paths: [{ name: 'blog', path: '/blog' }],
  },
  roles: {
    roles: [
      {
        name: 'admin',
        label: 'Admin',
        is_system: true,
        hierarchy_level: 0,
        permissions: [
          'content:read', 'content:create', 'content:edit', 'content:delete',
          'media:read', 'media:create', 'media:edit', 'media:delete',
          'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
          'users:read', 'users:create', 'users:edit', 'users:delete',
          'roles:read', 'roles:create', 'roles:edit', 'roles:delete',
        ],
      },
      {
        name: 'manager',
        label: 'Manager',
        is_system: true,
        hierarchy_level: 1,
        permissions: [
          'content:read', 'content:create', 'content:edit', 'content:delete',
          'media:read', 'media:create', 'media:edit', 'media:delete',
          'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
          'users:read', 'users:create', 'users:edit',
        ],
      },
      {
        name: 'editor',
        label: 'Editor',
        is_system: true,
        hierarchy_level: 2,
        permissions: [
          'content:read', 'content:create', 'content:edit', 'content:delete',
          'media:read', 'media:create',
          'taxonomy:read', 'taxonomy:edit',
        ],
      },
      {
        name: 'writer',
        label: 'Writer',
        is_system: true,
        hierarchy_level: 3,
        permissions: [
          'content:read', 'content:create', 'content:edit',
          'media:read',
        ],
      },
      {
        name: 'viewer',
        label: 'Viewer',
        is_system: true,
        hierarchy_level: 4,
        permissions: [
          'content:read',
          'media:read',
          'taxonomy:read',
        ],
      },
    ],
    valid_permissions: [
      'content:read', 'content:create', 'content:edit', 'content:delete',
      'media:read', 'media:create', 'media:edit', 'media:delete',
      'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
      'users:read', 'users:create', 'users:edit', 'users:delete',
      'roles:read', 'roles:create', 'roles:edit', 'roles:delete',
    ],
  },
  schemas: {
    'content--article':       articleSchema,
    'taxonomy--category':     categorySchema,
    'paragraph--pull_quote':  pullQuoteSchema,
    'enum--article_status':   articleStatusSchema,
  },
  content_types:   { 'content--article': articleSchema },
  taxonomy_types:  { 'taxonomy--category': categorySchema },
  paragraph_types: { 'paragraph--pull_quote': pullQuoteSchema },
  enum_types:      { 'enum--article_status': articleStatusSchema },
  all_schemas: [articleSchema, categorySchema, pullQuoteSchema, articleStatusSchema],
}

// ─── Role user fixtures ───────────────────────────────────────────────────────

export type TestRoleUser = {
  id: string
  email: string
  password: string
  role: string
  token_version: number
  must_change_password: boolean
}

export const testRoleUsers: TestRoleUser[] = [
  {
    id: 'a0100000-0000-0000-0000-000000000001',
    email: 'admin@test.local',
    password: 'TestAdmin1!',
    role: 'admin',
    token_version: 0,
    must_change_password: false,
  },
  {
    id: 'a0200000-0000-0000-0000-000000000002',
    email: 'manager@test.local',
    password: 'TestManager1!',
    role: 'manager',
    token_version: 0,
    must_change_password: false,
  },
  {
    id: 'a0300000-0000-0000-0000-000000000003',
    email: 'editor@test.local',
    password: 'TestEditor1!',
    role: 'editor',
    token_version: 0,
    must_change_password: false,
  },
  {
    id: 'a0400000-0000-0000-0000-000000000004',
    email: 'writer@test.local',
    password: 'TestWriter1!',
    role: 'writer',
    token_version: 0,
    must_change_password: false,
  },
  {
    id: 'a0500000-0000-0000-0000-000000000005',
    email: 'viewer@test.local',
    password: 'TestViewer1!',
    role: 'viewer',
    token_version: 0,
    must_change_password: false,
  },
]
