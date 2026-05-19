CREATE TYPE "public"."content_profile" AS ENUM('default', 'datHere');--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "content_profile" "content_profile";