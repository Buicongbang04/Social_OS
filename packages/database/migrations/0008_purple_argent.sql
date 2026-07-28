CREATE TYPE "public"."secret_scope" AS ENUM('PLATFORM', 'WORKSPACE');--> statement-breakpoint
CREATE TABLE "secret_versions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"secret_id" varchar(40) NOT NULL,
	"version" integer NOT NULL,
	"key_id" varchar(40) NOT NULL,
	"iv" varchar(32) NOT NULL,
	"tag" varchar(32) NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40),
	"scope" "secret_scope" NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"active_version" integer DEFAULT 1 NOT NULL,
	"hint" varchar(40) DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
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
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "secret_versions_key" ON "secret_versions" USING btree ("secret_id","version");--> statement-breakpoint
CREATE INDEX "secret_versions_key_id_idx" ON "secret_versions" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "secrets_workspace_idx" ON "secrets" USING btree ("workspace_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_name_key" ON "secrets" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "secrets_platform_name_key" ON "secrets" USING btree ("name") WHERE "secrets"."workspace_id" is null;--> statement-breakpoint
CREATE INDEX "secrets_expiry_idx" ON "secrets" USING btree ("expires_at");