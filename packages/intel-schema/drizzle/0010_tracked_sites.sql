CREATE TABLE "tracked_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"agent_nick_site_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracked_sites" ADD CONSTRAINT "tracked_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sites" ADD CONSTRAINT "tracked_sites_agent_nick_site_id_agent_nick_sites_id_fk" FOREIGN KEY ("agent_nick_site_id") REFERENCES "public"."agent_nick_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_sites_tenant_url_uq" ON "tracked_sites" USING btree ("tenant_id","url");--> statement-breakpoint
CREATE INDEX "tracked_sites_repo_idx" ON "tracked_sites" USING btree ("agent_nick_site_id");--> statement-breakpoint
INSERT INTO "tracked_sites" ("tenant_id", "url") SELECT "id", "site_url" FROM "tenants" WHERE "site_url" IS NOT NULL ON CONFLICT DO NOTHING;
