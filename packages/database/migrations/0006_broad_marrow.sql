DROP INDEX "conversations_workspace_idx";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "summarised_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_workspace_idx" ON "conversations" USING btree ("workspace_id",coalesce("last_message_at", "created_at") desc);