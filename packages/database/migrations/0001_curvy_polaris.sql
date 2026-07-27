CREATE TYPE "public"."execution_status" AS ENUM('CREATED', 'VALIDATING', 'PLANNING', 'READY', 'SCHEDULED', 'RUNNING', 'WAITING', 'PAUSED', 'CANCELLING', 'CANCELLED', 'FAILED', 'RETRYING', 'COMPLETED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."goal_priority" AS ENUM('CRITICAL', 'HIGH', 'NORMAL', 'LOW');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('CREATED', 'VALIDATED', 'PLANNED', 'EXECUTING', 'COMPLETED', 'FAILED', 'RETRY', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."goal_type" AS ENUM('CHAT', 'CONTENT', 'CAMPAIGN', 'RESEARCH', 'AUTOMATION', 'PUBLISHING', 'MULTI_STEP');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'BACKGROUND');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('PENDING', 'READY', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'RETRY', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"type" varchar(80) NOT NULL,
	"source" varchar(60) NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"execution_id" varchar(40),
	"task_id" varchar(40),
	"correlation_id" varchar(64) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"goal_id" varchar(40) NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"owner_id" varchar(40) NOT NULL,
	"status" "execution_status" DEFAULT 'CREATED' NOT NULL,
	"priority" "goal_priority" DEFAULT 'NORMAL' NOT NULL,
	"plan" jsonb,
	"outputs" jsonb,
	"failure_reason" text,
	"correlation_id" varchar(64) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(40),
	"updated_by" varchar(40),
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"owner_id" varchar(40) NOT NULL,
	"title" varchar(300) NOT NULL,
	"objective" text NOT NULL,
	"description" text,
	"type" "goal_type" DEFAULT 'CONTENT' NOT NULL,
	"priority" "goal_priority" DEFAULT 'NORMAL' NOT NULL,
	"status" "goal_status" DEFAULT 'CREATED' NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"schedule" jsonb,
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
CREATE TABLE "tasks" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"execution_id" varchar(40) NOT NULL,
	"workspace_id" varchar(40) NOT NULL,
	"capability" varchar(120) NOT NULL,
	"worker_id" varchar(64),
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outputs" jsonb,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'PENDING' NOT NULL,
	"priority" "task_priority" DEFAULT 'NORMAL' NOT NULL,
	"timeout_ms" integer NOT NULL,
	"retry_policy" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(40),
	"updated_by" varchar(40),
	"version" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_events_execution_idx" ON "execution_events" USING btree ("execution_id","timestamp");--> statement-breakpoint
CREATE INDEX "execution_events_correlation_idx" ON "execution_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "execution_events_workspace_idx" ON "execution_events" USING btree ("workspace_id","timestamp");--> statement-breakpoint
CREATE INDEX "execution_events_type_idx" ON "execution_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "executions_workspace_idx" ON "executions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "executions_goal_idx" ON "executions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "executions_correlation_idx" ON "executions" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "goals_workspace_idx" ON "goals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "goals_owner_idx" ON "goals" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tasks_execution_idx" ON "tasks" USING btree ("execution_id","status");--> statement-breakpoint
CREATE INDEX "tasks_workspace_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");