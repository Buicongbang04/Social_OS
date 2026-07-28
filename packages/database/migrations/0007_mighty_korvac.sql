CREATE TYPE "public"."memory_source" AS ENUM('MANUAL', 'LEARNED');--> statement-breakpoint
CREATE TABLE "workspace_memory" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"key" varchar(120) NOT NULL,
	"value" text NOT NULL,
	"source" "memory_source" DEFAULT 'MANUAL' NOT NULL,
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
ALTER TABLE "workspace_memory" ADD CONSTRAINT "workspace_memory_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_memory_workspace_idx" ON "workspace_memory" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_memory_key_key" ON "workspace_memory" USING btree ("workspace_id","key");