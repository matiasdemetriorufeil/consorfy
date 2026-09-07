CREATE TABLE "reminder_notice_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reminder_id" uuid NOT NULL,
	"notice_days" integer NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reminder_notice_thresholds_notice_days_range" CHECK ("reminder_notice_thresholds"."notice_days" >= 0 and "reminder_notice_thresholds"."notice_days" <= 365)
);
--> statement-breakpoint
ALTER TABLE "reminder_notice_thresholds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminder_notice_thresholds" ADD CONSTRAINT "reminder_notice_thresholds_reminder_id_organization_id_reminders_id_organization_id_fk" FOREIGN KEY ("reminder_id","organization_id") REFERENCES "public"."reminders"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_notice_thresholds_reminder_id_notice_days_unique" ON "reminder_notice_thresholds" USING btree ("reminder_id","notice_days") WHERE "reminder_notice_thresholds"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "deny_anon_authenticated" ON "reminder_notice_thresholds" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);