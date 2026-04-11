CREATE TYPE "public"."attestation_type" AS ENUM('consistency', 'evaluation', 're_evaluation', 'correction');--> statement-breakpoint
CREATE TYPE "public"."prompt_visibility" AS ENUM('full_text', 'hash_only');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unverified', 'consistency_tested', 'evaluated', 'fully_attested');--> statement-breakpoint
CREATE TABLE "attestation_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_record_id" uuid NOT NULL,
	"type" "attestation_type" NOT NULL,
	"creator_id" uuid NOT NULL,
	"package_hash" text NOT NULL,
	"storage_key" text NOT NULL,
	"references_base_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"prompt_visibility" "prompt_visibility" DEFAULT 'full_text' NOT NULL,
	"prompt_text" text,
	"base_package_hash" text,
	"base_package_storage_key" text,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_records_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" text NOT NULL,
	"display_name" text NOT NULL,
	"github_profile_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "attestation_packages" ADD CONSTRAINT "attestation_packages_evidence_record_id_evidence_records_id_fk" FOREIGN KEY ("evidence_record_id") REFERENCES "public"."evidence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attestation_packages" ADD CONSTRAINT "attestation_packages_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;