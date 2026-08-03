CREATE TYPE "public"."campaign_status" AS ENUM('DRAFT', 'ACTIVE', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."content_piece_status" AS ENUM('DRAFT', 'APPROVED', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"objective" text,
	"status" "campaign_status" DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
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
CREATE TABLE "content_pieces" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"campaign_id" varchar(40),
	"title" varchar(300) NOT NULL,
	"body" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"channel" varchar(40) NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" "content_piece_status" DEFAULT 'DRAFT' NOT NULL,
	"published_post_id" varchar(200),
	"published_at" timestamp with time zone,
	"last_error" text,
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
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_workspace_idx" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_period_idx" ON "campaigns" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "content_pieces_calendar_idx" ON "content_pieces" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "content_pieces_campaign_idx" ON "content_pieces" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "content_pieces_due_idx" ON "content_pieces" USING btree ("status","scheduled_at");