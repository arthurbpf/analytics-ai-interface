CREATE TABLE "auth_sessions" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"revokedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_attempts" (
	"tokenHash" text PRIMARY KEY NOT NULL,
	"stateHash" text NOT NULL,
	"verifier" text NOT NULL,
	"nonce" text NOT NULL,
	"guestTokenHash" text,
	"expiresAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_attempts" (
	"sessionId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"usage" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"googleSubject" text,
	"name" text,
	"email" text,
	CONSTRAINT "users_googleSubject_unique" UNIQUE("googleSubject")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ownerId" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "title" text DEFAULT 'New chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "titleStatus" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "titleRevision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "userMessageCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "title_attempts" ADD CONSTRAINT "title_attempts_sessionId_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "title_attempt_revision" ON "title_attempts" USING btree ("sessionId","revision");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;