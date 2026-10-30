-- Repair: restore every primary key, unique constraint, index and foreign key
-- the schema defines, where the database lacks them. The Oct 2026 move to the
-- new Neon project left production without some of them, so every
-- ON CONFLICT upsert (tool registry, daily rollups, policies, …) failed.
--
-- Idempotent: nothing that already exists is touched. Before a unique key is
-- added to a cache or rollup table (daily counts, forecasts, insights, the tool
-- registry, site memory), duplicate keys are removed; those tables are rebuilt
-- by the SDK anyway. No other table is de-duplicated: if one had duplicates,
-- this migration stops (one transaction) and changes nothing.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_keys'::regclass AND contype = 'p') THEN
    ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_nick_events'::regclass AND contype = 'p') THEN
    ALTER TABLE "agent_nick_events" ADD CONSTRAINT "agent_nick_events_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_nick_runs'::regclass AND contype = 'p') THEN
    ALTER TABLE "agent_nick_runs" ADD CONSTRAINT "agent_nick_runs_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_nick_sites'::regclass AND contype = 'p') THEN
    ALTER TABLE "agent_nick_sites" ADD CONSTRAINT "agent_nick_sites_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_nick_tools'::regclass AND contype = 'p') THEN
    ALTER TABLE "agent_nick_tools" ADD CONSTRAINT "agent_nick_tools_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.agent_traffic_daily'::regclass AND contype = 'p') THEN
    DELETE FROM "agent_traffic_daily" a USING "agent_traffic_daily" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "agent_traffic_daily" ADD CONSTRAINT "agent_traffic_daily_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.billing_events'::regclass AND contype = 'p') THEN
    ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_pkey" PRIMARY KEY (event_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.billing_subscriptions'::regclass AND contype = 'p') THEN
    ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.billing_usage'::regclass AND contype = 'p') THEN
    ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.connectors'::regclass AND contype = 'p') THEN
    ALTER TABLE "connectors" ADD CONSTRAINT "connectors_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.forecasts'::regclass AND contype = 'p') THEN
    DELETE FROM "forecasts" a USING "forecasts" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.github_installations'::regclass AND contype = 'p') THEN
    ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.insights'::regclass AND contype = 'p') THEN
    DELETE FROM "insights" a USING "insights" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "insights" ADD CONSTRAINT "insights_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND contype = 'p') THEN
    ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_event_daily'::regclass AND contype = 'p') THEN
    DELETE FROM "sdk_event_daily" a USING "sdk_event_daily" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "sdk_event_daily" ADD CONSTRAINT "sdk_event_daily_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_events'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_events" ADD CONSTRAINT "sdk_events_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_forecasts'::regclass AND contype = 'p') THEN
    DELETE FROM "sdk_forecasts" a USING "sdk_forecasts" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "sdk_forecasts" ADD CONSTRAINT "sdk_forecasts_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_ingest_keys'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_ingest_keys" ADD CONSTRAINT "sdk_ingest_keys_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_insights'::regclass AND contype = 'p') THEN
    DELETE FROM "sdk_insights" a USING "sdk_insights" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "sdk_insights" ADD CONSTRAINT "sdk_insights_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_policies'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_policies" ADD CONSTRAINT "sdk_policies_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_publishable_keys'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_publishable_keys" ADD CONSTRAINT "sdk_publishable_keys_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_site_memory'::regclass AND contype = 'p') THEN
    DELETE FROM "sdk_site_memory" a USING "sdk_site_memory" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "sdk_site_memory" ADD CONSTRAINT "sdk_site_memory_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_tool_descriptions'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_tool_descriptions" ADD CONSTRAINT "sdk_tool_descriptions_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_tool_registry'::regclass AND contype = 'p') THEN
    DELETE FROM "sdk_tool_registry" a USING "sdk_tool_registry" b WHERE a.ctid < b.ctid AND a."id" = b."id";
    ALTER TABLE "sdk_tool_registry" ADD CONSTRAINT "sdk_tool_registry_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sdk_webhooks'::regclass AND contype = 'p') THEN
    ALTER TABLE "sdk_webhooks" ADD CONSTRAINT "sdk_webhooks_pkey" PRIMARY KEY (tenant_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.site_scans'::regclass AND contype = 'p') THEN
    ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenants'::regclass AND contype = 'p') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tracked_sites'::regclass AND contype = 'p') THEN
    ALTER TABLE "tracked_sites" ADD CONSTRAINT "tracked_sites_pkey" PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.workspace_plans'::regclass AND contype = 'p') THEN
    ALTER TABLE "workspace_plans" ADD CONSTRAINT "workspace_plans_pkey" PRIMARY KEY (tenant_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_clerk_org_id_unique') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tenants_clerk_org_id_unique') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_clerk_org_id_unique" UNIQUE (clerk_org_id);
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_keys_hash_uq ON public.agent_keys USING btree (hashed_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_keys_tenant_idx ON public.agent_keys USING btree (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_events_run_idx ON public.agent_nick_events USING btree (run_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_runs_pr_idx ON public.agent_nick_runs USING btree (pr_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_runs_site_idx ON public.agent_nick_runs USING btree (site_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_runs_tenant_idx ON public.agent_nick_runs USING btree (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_sites_repo_idx ON public.agent_nick_sites USING btree (repo_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_nick_sites_tenant_repo_uq ON public.agent_nick_sites USING btree (tenant_id, repo_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_nick_tools_run_name_uq ON public.agent_nick_tools USING btree (run_id, name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_nick_tools_site_idx ON public.agent_nick_tools USING btree (site_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_traffic_daily_tenant_date_idx ON public.agent_traffic_daily USING btree (tenant_id, date);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'agent_traffic_daily_uq') THEN
    DELETE FROM "agent_traffic_daily" a USING "agent_traffic_daily" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."date" = b."date" AND a."source" = b."source" AND a."agent_name" = b."agent_name";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_traffic_daily_uq ON public.agent_traffic_daily USING btree (tenant_id, date, source, agent_name);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_rzp_uq ON public.billing_subscriptions USING btree (razorpay_subscription_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS billing_subscriptions_tenant_idx ON public.billing_subscriptions USING btree (tenant_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS billing_usage_uq ON public.billing_usage USING btree (tenant_id, period);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS connectors_tenant_type_uq ON public.connectors USING btree (tenant_id, type);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'forecasts_uq') THEN
    DELETE FROM "forecasts" a USING "forecasts" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."metric" = b."metric" AND a."horizon_date" = b."horizon_date";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS forecasts_uq ON public.forecasts USING btree (tenant_id, metric, horizon_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS github_installations_inst_idx ON public.github_installations USING btree (installation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS github_installations_tenant_inst_uq ON public.github_installations USING btree (tenant_id, installation_id);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'insights_job_kind_uq') THEN
    DELETE FROM "insights" a USING "insights" b WHERE a.ctid < b.ctid AND a."job_id" = b."job_id" AND a."kind" = b."kind";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS insights_job_kind_uq ON public.insights USING btree (job_id, kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS insights_tenant_created_idx ON public.insights USING btree (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_status_idx ON public.jobs USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_tenant_created_idx ON public.jobs USING btree (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_event_daily_tenant_date_idx ON public.sdk_event_daily USING btree (tenant_id, date);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sdk_event_daily_uq') THEN
    DELETE FROM "sdk_event_daily" a USING "sdk_event_daily" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."date" = b."date" AND a."type" = b."type" AND a."agent_class" = b."agent_class" AND a."outcome" = b."outcome";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_event_daily_uq ON public.sdk_event_daily USING btree (tenant_id, date, type, agent_class, outcome);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_events_tenant_ingested_idx ON public.sdk_events USING btree (tenant_id, ingested_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_events_tenant_occurred_idx ON public.sdk_events USING btree (tenant_id, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_events_tenant_site_idx ON public.sdk_events USING btree (tenant_id, site_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_events_tenant_type_idx ON public.sdk_events USING btree (tenant_id, type, occurred_at);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sdk_forecasts_uq') THEN
    DELETE FROM "sdk_forecasts" a USING "sdk_forecasts" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."metric" = b."metric" AND a."horizon_date" = b."horizon_date";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_forecasts_uq ON public.sdk_forecasts USING btree (tenant_id, metric, horizon_date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_ingest_keys_hash_uq ON public.sdk_ingest_keys USING btree (hashed_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_ingest_keys_tenant_idx ON public.sdk_ingest_keys USING btree (tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_insights_tenant_created_idx ON public.sdk_insights USING btree (tenant_id, created_at);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sdk_insights_uq') THEN
    DELETE FROM "sdk_insights" a USING "sdk_insights" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."kind" = b."kind";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_insights_uq ON public.sdk_insights USING btree (tenant_id, kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_policies_tenant_idx ON public.sdk_policies USING btree (tenant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_policies_uq ON public.sdk_policies USING btree (tenant_id, site_id, tool);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_publishable_keys_key_uq ON public.sdk_publishable_keys USING btree (key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sdk_publishable_keys_tenant_idx ON public.sdk_publishable_keys USING btree (tenant_id);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sdk_site_memory_uq') THEN
    DELETE FROM "sdk_site_memory" a USING "sdk_site_memory" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."site_id" = b."site_id";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_site_memory_uq ON public.sdk_site_memory USING btree (tenant_id, site_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_tool_descriptions_uq ON public.sdk_tool_descriptions USING btree (tenant_id, site_id, tool_name);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'sdk_tool_registry_uq') THEN
    DELETE FROM "sdk_tool_registry" a USING "sdk_tool_registry" b WHERE a.ctid < b.ctid AND a."tenant_id" = b."tenant_id" AND a."site_id" = b."site_id" AND a."tool_name" = b."tool_name";
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sdk_tool_registry_uq ON public.sdk_tool_registry USING btree (tenant_id, site_id, tool_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_scans_tenant_created_idx ON public.site_scans USING btree (tenant_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tracked_sites_repo_idx ON public.tracked_sites USING btree (agent_nick_site_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tracked_sites_tenant_url_uq ON public.tracked_sites USING btree (tenant_id, url);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_keys_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_events_run_id_agent_nick_runs_id_fk') THEN
    ALTER TABLE "agent_nick_events" ADD CONSTRAINT "agent_nick_events_run_id_agent_nick_runs_id_fk" FOREIGN KEY (run_id) REFERENCES agent_nick_runs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_runs_site_id_agent_nick_sites_id_fk') THEN
    ALTER TABLE "agent_nick_runs" ADD CONSTRAINT "agent_nick_runs_site_id_agent_nick_sites_id_fk" FOREIGN KEY (site_id) REFERENCES agent_nick_sites(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_runs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "agent_nick_runs" ADD CONSTRAINT "agent_nick_runs_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_sites_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "agent_nick_sites" ADD CONSTRAINT "agent_nick_sites_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_tools_run_id_agent_nick_runs_id_fk') THEN
    ALTER TABLE "agent_nick_tools" ADD CONSTRAINT "agent_nick_tools_run_id_agent_nick_runs_id_fk" FOREIGN KEY (run_id) REFERENCES agent_nick_runs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_nick_tools_site_id_agent_nick_sites_id_fk') THEN
    ALTER TABLE "agent_nick_tools" ADD CONSTRAINT "agent_nick_tools_site_id_agent_nick_sites_id_fk" FOREIGN KEY (site_id) REFERENCES agent_nick_sites(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_traffic_daily_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "agent_traffic_daily" ADD CONSTRAINT "agent_traffic_daily_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_subscriptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_usage_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "billing_usage" ADD CONSTRAINT "billing_usage_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'connectors_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forecasts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'github_installations_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'insights_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_connector_id_connectors_id_fk') THEN
    ALTER TABLE "jobs" ADD CONSTRAINT "jobs_connector_id_connectors_id_fk" FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_event_daily_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_event_daily" ADD CONSTRAINT "sdk_event_daily_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_events" ADD CONSTRAINT "sdk_events_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_forecasts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_forecasts" ADD CONSTRAINT "sdk_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_ingest_keys_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_ingest_keys" ADD CONSTRAINT "sdk_ingest_keys_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_insights_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_insights" ADD CONSTRAINT "sdk_insights_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_policies_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_policies" ADD CONSTRAINT "sdk_policies_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_publishable_keys_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_publishable_keys" ADD CONSTRAINT "sdk_publishable_keys_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_site_memory_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_site_memory" ADD CONSTRAINT "sdk_site_memory_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_tool_descriptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_tool_descriptions" ADD CONSTRAINT "sdk_tool_descriptions_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_tool_registry_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_tool_registry" ADD CONSTRAINT "sdk_tool_registry_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sdk_webhooks_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sdk_webhooks" ADD CONSTRAINT "sdk_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_scans_run_id_agent_nick_runs_id_fk') THEN
    ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_run_id_agent_nick_runs_id_fk" FOREIGN KEY (run_id) REFERENCES agent_nick_runs(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'site_scans_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "site_scans" ADD CONSTRAINT "site_scans_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_sites_agent_nick_site_id_agent_nick_sites_id_fk') THEN
    ALTER TABLE "tracked_sites" ADD CONSTRAINT "tracked_sites_agent_nick_site_id_agent_nick_sites_id_fk" FOREIGN KEY (agent_nick_site_id) REFERENCES agent_nick_sites(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_sites_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tracked_sites" ADD CONSTRAINT "tracked_sites_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_plans_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "workspace_plans" ADD CONSTRAINT "workspace_plans_tenant_id_tenants_id_fk" FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
