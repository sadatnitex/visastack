CREATE TYPE "public"."billing_status" AS ENUM('TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID');--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "billing_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_organization_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "billing_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_account_id" uuid NOT NULL,
	"from_status" "billing_status",
	"to_status" "billing_status" NOT NULL,
	"actor_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"invoice_ref" text NOT NULL,
	"invoiced_amount_minor_units" integer NOT NULL,
	"currency" text NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"status" "invoice_status" DEFAULT 'OPEN' NOT NULL,
	"collected_amount_minor_units" integer DEFAULT 0 NOT NULL,
	"collected_date" timestamp with time zone,
	"payment_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_ref_unique" UNIQUE("invoice_ref"),
	CONSTRAINT "invoices_period_order" CHECK ("invoices"."period_end" > "invoices"."period_start"),
	CONSTRAINT "invoices_collected_not_over_invoiced" CHECK ("invoices"."collected_amount_minor_units" <= "invoices"."invoiced_amount_minor_units"),
	CONSTRAINT "invoices_amounts_non_negative" CHECK ("invoices"."invoiced_amount_minor_units" >= 0 and "invoices"."collected_amount_minor_units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_status_history" ADD CONSTRAINT "billing_status_history_billing_account_id_billing_accounts_id_fk" FOREIGN KEY ("billing_account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_status_history" ADD CONSTRAINT "billing_status_history_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_status_history_account_idx" ON "billing_status_history" USING btree ("billing_account_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_idx" ON "invoices" USING btree ("organization_id");