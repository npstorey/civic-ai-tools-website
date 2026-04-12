ALTER TABLE "evidence_records" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "withdrawal_signature" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "withdrawal_timestamp" text;