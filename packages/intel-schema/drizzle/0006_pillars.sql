CREATE TABLE "sdk_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" text DEFAULT '*' NOT NULL,
	"tool" text NOT NULL,
	"decision" text NOT NULL,
	"min_trust" text DEFAULT 'detected' NOT NULL,
	"allowed_classes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rate_limit" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdk_publishable_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text DEFAULT 'default' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sdk_tool_descriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"original" text NOT NULL,
	"suggested" text NOT NULL,
	"original_tokens" integer NOT NULL,
	"suggested_tokens" integer NOT NULL,
	"rationale" text,
	"status" text DEFAULT 'suggested' NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "annotations" jsonb;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "status_error" text;--> statement-breakpoint
ALTER TABLE "sdk_tool_registry" ADD COLUMN "status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sdk_policies" ADD CONSTRAINT "sdk_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_publishable_keys" ADD CONSTRAINT "sdk_publishable_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdk_tool_descriptions" ADD CONSTRAINT "sdk_tool_descriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_policies_uq" ON "sdk_policies" USING btree ("tenant_id","site_id","tool");--> statement-breakpoint
CREATE INDEX "sdk_policies_tenant_idx" ON "sdk_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_publishable_keys_key_uq" ON "sdk_publishable_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sdk_publishable_keys_tenant_idx" ON "sdk_publishable_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sdk_tool_descriptions_uq" ON "sdk_tool_descriptions" USING btree ("tenant_id","site_id","tool_name");