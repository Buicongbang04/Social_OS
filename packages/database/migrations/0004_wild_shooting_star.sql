CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'INDEXING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"uploaded_by" varchar(40),
	"title" varchar(300) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(150) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"embedding_model" varchar(120),
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(40),
	"updated_by" varchar(40),
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(40),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_workspace_idx" ON "documents" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_checksum_key" ON "documents" USING btree ("workspace_id","checksum");