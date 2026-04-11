CREATE TYPE "public"."consistency_classification" AS ENUM('highly_reproducible', 'moderately_stable', 'inconsistent');--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "system_prompt_hash" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "mcp_server" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "jurisdiction" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "civic_context" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "consistency_classification" "consistency_classification";