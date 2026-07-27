ALTER TABLE "goals" ADD COLUMN "next_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "last_run_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "goals_next_run_idx" ON "goals" USING btree ("next_run_at");