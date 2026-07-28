CREATE TYPE "public"."execution_trigger" AS ENUM('MANUAL', 'SCHEDULE');--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "trigger" "execution_trigger" DEFAULT 'MANUAL' NOT NULL;