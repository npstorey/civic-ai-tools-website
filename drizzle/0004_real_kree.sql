ALTER TABLE "evidence_records" ADD COLUMN "reinstated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "reinstated_reason" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "reinstatement_signature" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "reinstatement_timestamp" text;