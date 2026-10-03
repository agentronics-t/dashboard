CREATE TABLE "billing_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"razorpay_subscription_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"razorpay_subscription_id" text NOT NULL,
	"razorpay_plan_id" text NOT NULL,
	"plan" text NOT NULL,
	"cycle" text NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"status_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_cycle_end" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_rzp_uq" ON "billing_subscriptions" USING btree ("razorpay_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_tenant_idx" ON "billing_subscriptions" USING btree ("tenant_id","created_at");