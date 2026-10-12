CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"sessionId" uuid NOT NULL,
	"turnId" uuid NOT NULL,
	"content" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_results" (
	"ref" uuid PRIMARY KEY NOT NULL,
	"sessionId" uuid NOT NULL,
	"turnId" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "query_results_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sessionId" uuid NOT NULL,
	"clientTurnId" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"error" jsonb,
	"usage" jsonb
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_turnId_turns_id_fk" FOREIGN KEY ("turnId") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_results" ADD CONSTRAINT "query_results_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_results" ADD CONSTRAINT "query_results_turnId_turns_id_fk" FOREIGN KEY ("turnId") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_history" ON "messages" USING btree ("sessionId","sequence");--> statement-breakpoint
CREATE INDEX "result_history" ON "query_results" USING btree ("sessionId","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "turn_request_unique" ON "turns" USING btree ("sessionId","clientTurnId");--> statement-breakpoint
CREATE UNIQUE INDEX "one_running_turn" ON "turns" USING btree ("sessionId") WHERE "turns"."status" = 'running';