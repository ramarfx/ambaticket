CREATE TABLE "buyer_quota" (
	"event_id" uuid NOT NULL,
	"buyer_id" text NOT NULL,
	"live_units" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "buyer_quota_event_id_buyer_id_pk" PRIMARY KEY("event_id","buyer_id"),
	CONSTRAINT "buyer_quota_live_check" CHECK ("buyer_quota"."live_units" between 0 and 4)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD COLUMN "held_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD COLUMN "sold_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "buyer_quota" ADD CONSTRAINT "buyer_quota_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_buyer_idempotency_key" ON "orders" USING btree ("buyer_id","idempotency_key") WHERE "orders"."idempotency_key" is not null;--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_stock_check" CHECK ("ticket_types"."held_units" >= 0 and "ticket_types"."sold_units" >= 0 and "ticket_types"."held_units" + "ticket_types"."sold_units" <= "ticket_types"."quota");