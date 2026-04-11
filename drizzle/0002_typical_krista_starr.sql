ALTER TABLE "evidence_records" ADD COLUMN "base_package_signature" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "base_package_rfc3161_timestamp" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "base_package_rekor_entry_id" text;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD COLUMN "base_package_rekor_inclusion_proof" text;