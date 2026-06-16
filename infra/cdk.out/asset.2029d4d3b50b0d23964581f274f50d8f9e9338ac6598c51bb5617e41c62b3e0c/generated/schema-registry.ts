export const schemaRegistry = {
  "routes": {
    "base_paths": [
      {
        "name": "blog",
        "path": "/blog"
      },
      {
        "name": "pages",
        "path": "/pages"
      }
    ]
  },
  "roles": {
    "roles": [
      {
        "name": "admin",
        "label": "Administrator",
        "is_system": true,
        "hierarchy_level": 1,
        "permissions": [
          "content:read",
          "content:create",
          "content:edit",
          "content:delete",
          "media:read",
          "media:create",
          "media:edit",
          "media:delete",
          "taxonomy:read",
          "taxonomy:create",
          "taxonomy:edit",
          "taxonomy:delete",
          "users:read",
          "users:create",
          "users:edit",
          "users:delete",
          "roles:read"
        ]
      },
      {
        "name": "manager",
        "label": "Manager",
        "is_system": true,
        "hierarchy_level": 2,
        "permissions": [
          "content:read",
          "content:create",
          "content:edit",
          "content:delete",
          "media:read",
          "media:create",
          "media:edit",
          "media:delete",
          "taxonomy:read",
          "taxonomy:create",
          "taxonomy:edit",
          "taxonomy:delete",
          "users:read",
          "users:create",
          "users:edit",
          "roles:read"
        ]
      },
      {
        "name": "editor",
        "label": "Editor",
        "is_system": true,
        "hierarchy_level": 3,
        "permissions": [
          "content:read",
          "content:create",
          "content:edit",
          "media:read",
          "media:create",
          "media:edit",
          "taxonomy:read",
          "taxonomy:create",
          "taxonomy:edit"
        ]
      },
      {
        "name": "writer",
        "label": "Writer",
        "is_system": true,
        "hierarchy_level": 4,
        "permissions": [
          "content:read",
          "content:create",
          "media:read",
          "media:create",
          "taxonomy:read"
        ]
      },
      {
        "name": "viewer",
        "label": "Viewer",
        "is_system": true,
        "hierarchy_level": 5,
        "permissions": [
          "content:read",
          "media:read",
          "taxonomy:read"
        ]
      }
    ],
    "valid_permissions": [
      "content:read",
      "content:create",
      "content:edit",
      "content:delete",
      "media:read",
      "media:create",
      "media:edit",
      "media:delete",
      "taxonomy:read",
      "taxonomy:create",
      "taxonomy:edit",
      "taxonomy:delete",
      "users:read",
      "users:create",
      "users:edit",
      "users:delete",
      "roles:read"
    ]
  },
  "schemas": {
    "content--blog_post": {
      "schema_type": "content-type",
      "name": "content--blog_post",
      "label": "Blog Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--blog_post.json",
      "only_one": false,
      "default_base_path": "blog",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "blog_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "blog_hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "blog_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "blog_meta_title",
          "label": "Meta Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_meta_desc",
          "label": "Meta Description",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 4,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_desc",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_cards",
          "label": "Cards",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 5,
          "validation": {
            "required": true,
            "max_items": 8
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--photo_card",
            "rel": "one-to-many",
            "max": 8
          }
        },
        {
          "name": "blog_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": false,
          "nullable": true,
          "order": 6,
          "validation": {
            "required": false,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        },
        {
          "name": "blog_related",
          "label": "Related Posts",
          "field_type": "reference",
          "required": false,
          "nullable": true,
          "order": 7,
          "validation": {
            "required": false,
            "max_items": 10
          },
          "db_column": {
            "column_name": "",
            "column_type": "uuid",
            "nullable": true,
            "junction": {
              "table_name": "junction_content_blog_post_blog_related",
              "left_column": "left_id",
              "right_column": "right_id",
              "right_table": "content_blog_post",
              "order_column": false
            }
          },
          "ui_component": {
            "component": "typeahead-select",
            "ref": "content--blog_post",
            "rel": "many-to-many"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "blog_title",
              "blog_hero_image",
              "blog_desc"
            ]
          },
          {
            "name": "meta_info",
            "label": "Meta Information Tab",
            "fields": [
              "blog_meta_title",
              "blog_meta_desc"
            ]
          },
          {
            "name": "first_content_tab",
            "label": "First Content Block Tab",
            "fields": [
              "blog_cards",
              "blog_link",
              "blog_related"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_blog_post",
        "junction_tables": [
          {
            "table_name": "junction_content_blog_post_blog_related",
            "left_column": "left_id",
            "right_column": "right_id",
            "right_table": "content_blog_post",
            "order_column": false
          }
        ]
      },
      "api": {
        "default_base_path": "blog",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/blog-post",
        "item_path": "/api/blog-post/:slug"
      }
    },
    "content--example_page": {
      "schema_type": "content-type",
      "name": "content--example_page",
      "label": "Example Page",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--example_page.json",
      "only_one": false,
      "default_base_path": "pages",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "body",
          "label": "Body",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "body",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "title",
              "hero_image",
              "body"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_example_page",
        "junction_tables": []
      },
      "api": {
        "default_base_path": "pages",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/example-page",
        "item_path": "/api/example-page/:slug"
      }
    },
    "paragraph--card_image_link": {
      "schema_type": "paragraph-type",
      "name": "paragraph--card_image_link",
      "label": "Paragraph Card Image Link",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--card_image_link.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "card_image_link_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "card_image_link_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "card_image_link_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "card_image_link_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "card_image_link_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "card_image_link_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "card_image_link_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        }
      ],
      "db": {
        "table_name": "paragraph_card_image_link"
      }
    },
    "paragraph--link_item": {
      "schema_type": "paragraph-type",
      "name": "paragraph--link_item",
      "label": "Paragraph Link Item",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--link_item.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "link_item_url",
          "label": "url",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_url",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "link_item_target",
          "label": "Target",
          "field_type": "enum",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "allowed_values": [
              "_self",
              "_blank"
            ]
          },
          "db_column": {
            "column_name": "link_item_target",
            "column_type": "varchar",
            "nullable": false,
            "check_constraint": [
              "_self",
              "_blank"
            ]
          },
          "ui_component": {
            "component": "select",
            "options": [
              "_self",
              "_blank"
            ],
            "enum_ref": "enum--link_target"
          }
        },
        {
          "name": "link_item_text",
          "label": "Text",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_text",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_link_item"
      }
    },
    "paragraph--photo_card": {
      "schema_type": "paragraph-type",
      "name": "paragraph--photo_card",
      "label": "Paragraph Photo Card",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--photo_card.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "photo_card_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "photo_card_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "photo_card_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "photo_card_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "photo_card_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "photo_card_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_photo_card"
      }
    },
    "taxonomy--daily_post": {
      "schema_type": "taxonomy-type",
      "name": "taxonomy--daily_post",
      "label": "Daily Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/taxonomy-types/taxonomy--daily_post.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "daily_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "daily_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "taxonomy_daily_post"
      },
      "api": {
        "collection_path": "/api/taxonomy/daily-post",
        "item_path": "/api/taxonomy/daily-post/:id"
      }
    },
    "enum--link_target": {
      "schema_type": "enum-type",
      "name": "enum--link_target",
      "label": "Link Target",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/enum-types/enum--link_target.json",
      "values": [
        "_self",
        "_blank"
      ]
    }
  },
  "content_types": {
    "content--blog_post": {
      "schema_type": "content-type",
      "name": "content--blog_post",
      "label": "Blog Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--blog_post.json",
      "only_one": false,
      "default_base_path": "blog",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "blog_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "blog_hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "blog_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "blog_meta_title",
          "label": "Meta Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_meta_desc",
          "label": "Meta Description",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 4,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_desc",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_cards",
          "label": "Cards",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 5,
          "validation": {
            "required": true,
            "max_items": 8
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--photo_card",
            "rel": "one-to-many",
            "max": 8
          }
        },
        {
          "name": "blog_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": false,
          "nullable": true,
          "order": 6,
          "validation": {
            "required": false,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        },
        {
          "name": "blog_related",
          "label": "Related Posts",
          "field_type": "reference",
          "required": false,
          "nullable": true,
          "order": 7,
          "validation": {
            "required": false,
            "max_items": 10
          },
          "db_column": {
            "column_name": "",
            "column_type": "uuid",
            "nullable": true,
            "junction": {
              "table_name": "junction_content_blog_post_blog_related",
              "left_column": "left_id",
              "right_column": "right_id",
              "right_table": "content_blog_post",
              "order_column": false
            }
          },
          "ui_component": {
            "component": "typeahead-select",
            "ref": "content--blog_post",
            "rel": "many-to-many"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "blog_title",
              "blog_hero_image",
              "blog_desc"
            ]
          },
          {
            "name": "meta_info",
            "label": "Meta Information Tab",
            "fields": [
              "blog_meta_title",
              "blog_meta_desc"
            ]
          },
          {
            "name": "first_content_tab",
            "label": "First Content Block Tab",
            "fields": [
              "blog_cards",
              "blog_link",
              "blog_related"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_blog_post",
        "junction_tables": [
          {
            "table_name": "junction_content_blog_post_blog_related",
            "left_column": "left_id",
            "right_column": "right_id",
            "right_table": "content_blog_post",
            "order_column": false
          }
        ]
      },
      "api": {
        "default_base_path": "blog",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/blog-post",
        "item_path": "/api/blog-post/:slug"
      }
    },
    "content--example_page": {
      "schema_type": "content-type",
      "name": "content--example_page",
      "label": "Example Page",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--example_page.json",
      "only_one": false,
      "default_base_path": "pages",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "body",
          "label": "Body",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "body",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "title",
              "hero_image",
              "body"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_example_page",
        "junction_tables": []
      },
      "api": {
        "default_base_path": "pages",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/example-page",
        "item_path": "/api/example-page/:slug"
      }
    }
  },
  "paragraph_types": {
    "paragraph--card_image_link": {
      "schema_type": "paragraph-type",
      "name": "paragraph--card_image_link",
      "label": "Paragraph Card Image Link",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--card_image_link.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "card_image_link_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "card_image_link_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "card_image_link_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "card_image_link_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "card_image_link_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "card_image_link_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "card_image_link_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        }
      ],
      "db": {
        "table_name": "paragraph_card_image_link"
      }
    },
    "paragraph--link_item": {
      "schema_type": "paragraph-type",
      "name": "paragraph--link_item",
      "label": "Paragraph Link Item",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--link_item.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "link_item_url",
          "label": "url",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_url",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "link_item_target",
          "label": "Target",
          "field_type": "enum",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "allowed_values": [
              "_self",
              "_blank"
            ]
          },
          "db_column": {
            "column_name": "link_item_target",
            "column_type": "varchar",
            "nullable": false,
            "check_constraint": [
              "_self",
              "_blank"
            ]
          },
          "ui_component": {
            "component": "select",
            "options": [
              "_self",
              "_blank"
            ],
            "enum_ref": "enum--link_target"
          }
        },
        {
          "name": "link_item_text",
          "label": "Text",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_text",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_link_item"
      }
    },
    "paragraph--photo_card": {
      "schema_type": "paragraph-type",
      "name": "paragraph--photo_card",
      "label": "Paragraph Photo Card",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--photo_card.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "photo_card_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "photo_card_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "photo_card_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "photo_card_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "photo_card_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "photo_card_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_photo_card"
      }
    }
  },
  "taxonomy_types": {
    "taxonomy--daily_post": {
      "schema_type": "taxonomy-type",
      "name": "taxonomy--daily_post",
      "label": "Daily Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/taxonomy-types/taxonomy--daily_post.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "daily_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "daily_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "taxonomy_daily_post"
      },
      "api": {
        "collection_path": "/api/taxonomy/daily-post",
        "item_path": "/api/taxonomy/daily-post/:id"
      }
    }
  },
  "enum_types": {
    "enum--link_target": {
      "schema_type": "enum-type",
      "name": "enum--link_target",
      "label": "Link Target",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/enum-types/enum--link_target.json",
      "values": [
        "_self",
        "_blank"
      ]
    }
  },
  "all_schemas": [
    {
      "schema_type": "content-type",
      "name": "content--blog_post",
      "label": "Blog Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--blog_post.json",
      "only_one": false,
      "default_base_path": "blog",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "blog_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "blog_hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "blog_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "blog_meta_title",
          "label": "Meta Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_meta_desc",
          "label": "Meta Description",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 4,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "blog_meta_desc",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "blog_cards",
          "label": "Cards",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 5,
          "validation": {
            "required": true,
            "max_items": 8
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--photo_card",
            "rel": "one-to-many",
            "max": 8
          }
        },
        {
          "name": "blog_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": false,
          "nullable": true,
          "order": 6,
          "validation": {
            "required": false,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        },
        {
          "name": "blog_related",
          "label": "Related Posts",
          "field_type": "reference",
          "required": false,
          "nullable": true,
          "order": 7,
          "validation": {
            "required": false,
            "max_items": 10
          },
          "db_column": {
            "column_name": "",
            "column_type": "uuid",
            "nullable": true,
            "junction": {
              "table_name": "junction_content_blog_post_blog_related",
              "left_column": "left_id",
              "right_column": "right_id",
              "right_table": "content_blog_post",
              "order_column": false
            }
          },
          "ui_component": {
            "component": "typeahead-select",
            "ref": "content--blog_post",
            "rel": "many-to-many"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "blog_title",
              "blog_hero_image",
              "blog_desc"
            ]
          },
          {
            "name": "meta_info",
            "label": "Meta Information Tab",
            "fields": [
              "blog_meta_title",
              "blog_meta_desc"
            ]
          },
          {
            "name": "first_content_tab",
            "label": "First Content Block Tab",
            "fields": [
              "blog_cards",
              "blog_link",
              "blog_related"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_blog_post",
        "junction_tables": [
          {
            "table_name": "junction_content_blog_post_blog_related",
            "left_column": "left_id",
            "right_column": "right_id",
            "right_table": "content_blog_post",
            "order_column": false
          }
        ]
      },
      "api": {
        "default_base_path": "blog",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/blog-post",
        "item_path": "/api/blog-post/:slug"
      }
    },
    {
      "schema_type": "content-type",
      "name": "content--example_page",
      "label": "Example Page",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/content-types/content--example_page.json",
      "only_one": false,
      "default_base_path": "pages",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "slug",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "base_path_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "hero_image",
          "label": "Hero Image",
          "field_type": "image",
          "required": false,
          "nullable": true,
          "order": 1,
          "validation": {
            "required": false,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "hero_image",
            "column_type": "uuid",
            "nullable": true,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "body",
          "label": "Body",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "body",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "ui": {
        "tabs": [
          {
            "name": "primary_tab",
            "label": "Primary Tab",
            "fields": [
              "title",
              "hero_image",
              "body"
            ]
          }
        ]
      },
      "db": {
        "table_name": "content_example_page",
        "junction_tables": []
      },
      "api": {
        "default_base_path": "pages",
        "http_methods": [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE"
        ],
        "collection_path": "/api/example-page",
        "item_path": "/api/example-page/:slug"
      }
    },
    {
      "schema_type": "paragraph-type",
      "name": "paragraph--card_image_link",
      "label": "Paragraph Card Image Link",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--card_image_link.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "card_image_link_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "card_image_link_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "card_image_link_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "card_image_link_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "card_image_link_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "card_image_link_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        },
        {
          "name": "card_image_link_link",
          "label": "Link",
          "field_type": "paragraph",
          "required": true,
          "nullable": false,
          "order": 3,
          "validation": {
            "required": true,
            "max_items": 1
          },
          "db_column": null,
          "ui_component": {
            "component": "paragraph-embed",
            "ref": "paragraph--link_item",
            "rel": "one-to-one",
            "max": 1
          }
        }
      ],
      "db": {
        "table_name": "paragraph_card_image_link"
      }
    },
    {
      "schema_type": "paragraph-type",
      "name": "paragraph--link_item",
      "label": "Paragraph Link Item",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--link_item.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "link_item_url",
          "label": "url",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_url",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "link_item_target",
          "label": "Target",
          "field_type": "enum",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "allowed_values": [
              "_self",
              "_blank"
            ]
          },
          "db_column": {
            "column_name": "link_item_target",
            "column_type": "varchar",
            "nullable": false,
            "check_constraint": [
              "_self",
              "_blank"
            ]
          },
          "ui_component": {
            "component": "select",
            "options": [
              "_self",
              "_blank"
            ],
            "enum_ref": "enum--link_target"
          }
        },
        {
          "name": "link_item_text",
          "label": "Text",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 2,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "link_item_text",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_link_item"
      }
    },
    {
      "schema_type": "paragraph-type",
      "name": "paragraph--photo_card",
      "label": "Paragraph Photo Card",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/paragraph-types/paragraph--photo_card.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "parent_id",
          "db_type": "uuid",
          "nullable": false
        },
        {
          "name": "parent_type",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "parent_field",
          "db_type": "varchar",
          "nullable": false
        },
        {
          "name": "order",
          "db_type": "integer",
          "default": "0",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "photo_card_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "photo_card_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "photo_card_image",
          "label": "Image",
          "field_type": "image",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true,
            "max_size": 524288,
            "allowed_mime_types": [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "image/svg+xml"
            ]
          },
          "db_column": {
            "column_name": "photo_card_image",
            "column_type": "uuid",
            "nullable": false,
            "foreign_key": {
              "table": "media",
              "column": "id",
              "on_delete": "SET NULL"
            }
          },
          "ui_component": {
            "component": "file-upload",
            "accepted_mime_types": [
              "image/*"
            ]
          }
        },
        {
          "name": "photo_card_text",
          "label": "Text",
          "field_type": "text/rich",
          "required": false,
          "nullable": true,
          "order": 2,
          "validation": {
            "required": false
          },
          "db_column": {
            "column_name": "photo_card_text",
            "column_type": "text",
            "nullable": true
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "paragraph_photo_card"
      }
    },
    {
      "schema_type": "taxonomy-type",
      "name": "taxonomy--daily_post",
      "label": "Daily Post",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/taxonomy-types/taxonomy--daily_post.json",
      "system_fields": [
        {
          "name": "id",
          "db_type": "uuid",
          "primary_key": true,
          "default": "gen_random_uuid()",
          "nullable": false
        },
        {
          "name": "published",
          "db_type": "boolean",
          "default": "false",
          "nullable": false
        },
        {
          "name": "created_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        },
        {
          "name": "updated_at",
          "db_type": "timestamp",
          "default": "now()",
          "nullable": false
        }
      ],
      "fields": [
        {
          "name": "daily_title",
          "label": "Title",
          "field_type": "text/plain",
          "required": true,
          "nullable": false,
          "order": 0,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_title",
            "column_type": "varchar",
            "nullable": false
          },
          "ui_component": {
            "component": "text-input"
          }
        },
        {
          "name": "daily_desc",
          "label": "Description",
          "field_type": "text/rich",
          "required": true,
          "nullable": false,
          "order": 1,
          "validation": {
            "required": true
          },
          "db_column": {
            "column_name": "daily_desc",
            "column_type": "text",
            "nullable": false
          },
          "ui_component": {
            "component": "rich-text-editor"
          }
        }
      ],
      "db": {
        "table_name": "taxonomy_daily_post"
      },
      "api": {
        "collection_path": "/api/taxonomy/daily-post",
        "item_path": "/api/taxonomy/daily-post/:id"
      }
    },
    {
      "schema_type": "enum-type",
      "name": "enum--link_target",
      "label": "Link Target",
      "source_file": "/mnt/projects/manguito-cms/apps/sandbox/schemas/enum-types/enum--link_target.json",
      "values": [
        "_self",
        "_blank"
      ]
    }
  ]
} as const
