CREATE TYPE "public"."social_account_status" AS ENUM('ACTIVE', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"connector_id" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"display_name" varchar(300) NOT NULL,
	"avatar_url" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "social_account_status" DEFAULT 'ACTIVE' NOT NULL,
	"secret_name" varchar(200) NOT NULL,
	"expires_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
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
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "social_accounts_workspace_idx" ON "social_accounts" USING btree ("workspace_id","connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_external_key" ON "social_accounts" USING btree ("workspace_id","connector_id","external_id");--> statement-breakpoint
CREATE INDEX "social_accounts_expiry_idx" ON "social_accounts" USING btree ("expires_at");