CREATE TABLE "agent_nick_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_nick_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"step" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_nick_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"step" text DEFAULT 'queued' NOT NULL,
	"base_sha" text,
	"framework" text,
	"pages_found" integer DEFAULT 0 NOT NULL,
	"actions_found" integer DEFAULT 0 NOT NULL,
	"tools_proposed" integer DEFAULT 0 NOT NULL,
	"tools_approved" integer DEFAULT 0 NOT NULL,
	"files_changed" integer DEFAULT 0 NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"branch" text,
	"pr_number" integer,
	"pr_url" text,
	"head_sha" text,
	"ci_status" text,
	"fix_attempts" integer DEFAULT 0 NOT NULL,
	"decision" jsonb,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"merged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_nick_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_private" boolean DEFAULT true NOT NULL,
	"homepage" text,
	"framework" text,
	"status" text DEFAULT 'new' NOT NULL,
	"last_run_id" uuid,
	"live_sha" text,
	"live_at" timestamp with time zone,
	"live_tools" integer DEFAULT 0 NOT NULL,
	"last_push_sha" text,
	"last_push_at" timestamp with time zone,
	"last_push_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_nick_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"page" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"risk" text NOT NULL,
	"read_only" boolean DEFAULT false NOT NULL,
	"consequential" boolean DEFAULT false NOT NULL,
	"auth" text DEFAULT 'public' NOT NULL,
	"source" jsonb NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"file_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text NOT NULL,
	"installed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suspended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_plans" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"dodo_subscription_id" text,
	"dodo_customer_id" text,
	"checkout_session_id" text,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_nick_events" ADD CONSTRAINT "agent_nick_events_run_id_agent_nick_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_nick_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nick_runs" ADD CONSTRAINT "agent_nick_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nick_runs" ADD CONSTRAINT "agent_nick_runs_site_id_agent_nick_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."agent_nick_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nick_sites" ADD CONSTRAINT "agent_nick_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nick_tools" ADD CONSTRAINT "agent_nick_tools_run_id_agent_nick_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_nick_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nick_tools" ADD CONSTRAINT "agent_nick_tools_site_id_agent_nick_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."agent_nick_sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_plans" ADD CONSTRAINT "workspace_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_nick_events_run_idx" ON "agent_nick_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "agent_nick_runs_site_idx" ON "agent_nick_runs" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_nick_runs_tenant_idx" ON "agent_nick_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_nick_runs_pr_idx" ON "agent_nick_runs" USING btree ("pr_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_nick_sites_tenant_repo_uq" ON "agent_nick_sites" USING btree ("tenant_id","repo_id");--> statement-breakpoint
CREATE INDEX "agent_nick_sites_repo_idx" ON "agent_nick_sites" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_nick_tools_run_name_uq" ON "agent_nick_tools" USING btree ("run_id","name");--> statement-breakpoint
CREATE INDEX "agent_nick_tools_site_idx" ON "agent_nick_tools" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_tenant_inst_uq" ON "github_installations" USING btree ("tenant_id","installation_id");--> statement-breakpoint
CREATE INDEX "github_installations_inst_idx" ON "github_installations" USING btree ("installation_id");