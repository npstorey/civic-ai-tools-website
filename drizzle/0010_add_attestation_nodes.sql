CREATE TABLE "attestation_nodes" (
	"node_id" text PRIMARY KEY NOT NULL,
	"target_node_id" text NOT NULL,
	"type" text NOT NULL,
	"storage_key" text NOT NULL,
	"signature" text,
	"rfc3161_timestamp" text,
	"rekor_entry_id" text,
	"rekor_inclusion_proof" text,
	"signer" jsonb,
	"payload" jsonb,
	"creator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attestation_nodes" ADD CONSTRAINT "attestation_nodes_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;