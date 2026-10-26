CREATE TABLE "site_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid,
	"score" integer NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_run_id_agent_nick_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_nick_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_scans_tenant_created_idx" ON "site_scans" USING btree ("tenant_id","created_at");