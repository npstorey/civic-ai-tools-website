CREATE TYPE "public"."visibility" AS ENUM('published', 'committed');--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "visibility" "visibility" DEFAULT 'published' NOT NULL;