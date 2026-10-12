CREATE TABLE "content_nested_paragraph_test" (
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
ALTER TABLE "junction_content_blog_post_blog_related" ADD COLUMN "order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_nested_paragraph_test" ADD CONSTRAINT "content_nested_paragraph_test_hero_image_media_id_fk" FOREIGN KEY ("hero_image") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;