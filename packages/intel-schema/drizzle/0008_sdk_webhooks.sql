CREATE TABLE "sdk_webhooks" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cursor_id" text DEFAULT '' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" text,
	"last_delivery_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sdk_webhooks" ADD CONSTRAINT "sdk_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sdk_events_tenant_ingested_idx" ON "sdk_events" USING btree ("tenant_id","ingested_at","id");