CREATE TYPE "public"."sdk_event_outcome" AS ENUM('success', 'error', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."sdk_event_type" AS ENUM('agent.detected', 'agent.missed', 'auth.identity_presented', 'auth.identity_cleared', 'authz.policies_set', 'authz.evaluated', 'memory.accessed', 'memory.updated', 'tool.registered', 'tool.executed', 'tool.surfaced', 'tool.progressed', 'sdk.error');--> statement-breakpoint
CREATE TABLE "sdk_event_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "sdk_event_type" NOT NULL,
	"agent_class" text DEFAULT 'none' NOT NULL,
	"outcome" "sdk_event_outcome" NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"session_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" "sdk_event_type" NOT NULL,
	"tool" text,
	"agent_class" text,
	"agent_vendor" text,
	"trust" text,
	"outcome" "sdk_event_outcome" NOT NULL,
	"duration_ms" integer,
	"page" text,
	"protocol" text,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_ingest_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"hashed_key" text NOT NULL,
	"prefix" text NOT NULL,
	"label" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sdk_site_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_tool_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"group_name" text,
	"page" text,
	"input_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_schema" jsonb,
	"tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdk_event_daily" ADD CONSTRAINT "sdk_event_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_events" ADD CONSTRAINT "sdk_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_ingest_keys" ADD CONSTRAINT "sdk_ingest_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_site_memory" ADD CONSTRAINT "sdk_site_memory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD CONSTRAINT "sdk_tool_registry_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_event_daily_uq" ON "sdk_event_daily" USING btree ("tenant_id","date","type","agent_class","outcome");--> statement-breakpoint
CREATE INDEX "sdk_event_daily_tenant_date_idx" ON "sdk_event_daily" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "sdk_events_tenant_occurred_idx" ON "sdk_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sdk_events_tenant_type_idx" ON "sdk_events" USING btree ("tenant_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "sdk_events_tenant_site_idx" ON "sdk_events" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_ingest_keys_hash_uq" ON "sdk_ingest_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "sdk_ingest_keys_tenant_idx" ON "sdk_ingest_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_site_memory_uq" ON "sdk_site_memory" USING btree ("tenant_id","site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_tool_registry_uq" ON "sdk_tool_registry" USING btree ("tenant_id","site_id","tool_name");