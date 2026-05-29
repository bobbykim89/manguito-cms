CREATE TABLE "base_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" varchar(1024) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "base_paths_name_unique" UNIQUE("name"),
	CONSTRAINT "base_paths_path_unique" UNIQUE("path")
);
--> statement-breakpoint
CREATE TABLE "content_blog_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"base_path_id" uuid NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"blog_title" varchar(255) NOT NULL,
	"blog_hero_image" uuid,
	"blog_desc" text NOT NULL,
	"blog_meta_title" varchar(255) NOT NULL,
	"blog_meta_desc" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_example_page" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"base_path_id" uuid NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"title" varchar(255) NOT NULL,
	"hero_image" uuid,
	"body" text
);
--> statement-breakpoint
CREATE TABLE "junction_content_blog_post_blog_related" (
	"left_id" uuid NOT NULL,
	"right_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"url" varchar(2048) NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"alt" varchar(255),
	"file_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration" integer,
	"reference_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paragraph_card_image_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"parent_type" varchar NOT NULL,
	"parent_field" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"card_image_link_title" varchar(255) NOT NULL,
	"card_image_link_image" uuid NOT NULL,
	"card_image_link_text" text
);
--> statement-breakpoint
CREATE TABLE "paragraph_link_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"parent_type" varchar NOT NULL,
	"parent_field" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"link_item_url" varchar(255) NOT NULL,
	"link_item_target" varchar NOT NULL,
	"link_item_text" varchar(255) NOT NULL,
	CONSTRAINT "link_item_target_check" CHECK ("paragraph_link_item"."link_item_target" IN ('_self', '_blank'))
);
--> statement-breakpoint
CREATE TABLE "paragraph_photo_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"parent_type" varchar NOT NULL,
	"parent_field" varchar NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"photo_card_title" varchar(255) NOT NULL,
	"photo_card_image" uuid NOT NULL,
	"photo_card_text" text
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"label" varchar(255) NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"hierarchy_level" integer NOT NULL,
	"permissions" text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name"),
	CONSTRAINT "roles_hierarchy_level_unique" UNIQUE("hierarchy_level")
);
--> statement-breakpoint
CREATE TABLE "taxonomy_daily_post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"daily_title" varchar(255) NOT NULL,
	"daily_desc" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role_id" uuid NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "content_blog_post" ADD CONSTRAINT "content_blog_post_blog_hero_image_media_id_fk" FOREIGN KEY ("blog_hero_image") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_example_page" ADD CONSTRAINT "content_example_page_hero_image_media_id_fk" FOREIGN KEY ("hero_image") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_content_blog_post_blog_related" ADD CONSTRAINT "junction_content_blog_post_blog_related_left_id_content_blog_post_id_fk" FOREIGN KEY ("left_id") REFERENCES "public"."content_blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "junction_content_blog_post_blog_related" ADD CONSTRAINT "junction_content_blog_post_blog_related_right_id_content_blog_post_id_fk" FOREIGN KEY ("right_id") REFERENCES "public"."content_blog_post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paragraph_card_image_link" ADD CONSTRAINT "paragraph_card_image_link_card_image_link_image_media_id_fk" FOREIGN KEY ("card_image_link_image") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paragraph_photo_card" ADD CONSTRAINT "paragraph_photo_card_photo_card_image_media_id_fk" FOREIGN KEY ("photo_card_image") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;