CREATE TABLE "sdk_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"horizon_date" date NOT NULL,
	"p10" double precision NOT NULL,
	"p50" double precision NOT NULL,
	"p90" double precision NOT NULL,
	"model_version" text NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"severity" "insight_severity" DEFAULT 'info' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdk_forecasts" ADD CONSTRAINT "sdk_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_insights" ADD CONSTRAINT "sdk_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_forecasts_uq" ON "sdk_forecasts" USING btree ("tenant_id","metric","horizon_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_insights_uq" ON "sdk_insights" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "sdk_insights_tenant_created_idx" ON "sdk_insights" USING btree ("tenant_id","created_at");