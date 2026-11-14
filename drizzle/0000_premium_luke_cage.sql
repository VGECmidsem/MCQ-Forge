CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"marked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"remaining_seconds" integer,
	"time_taken_seconds" integer,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"source_label" text DEFAULT 'manual' NOT NULL,
	"page_number" integer,
	"question_number" integer,
	"text" text DEFAULT '' NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correct_answer" text,
	"answer_source" text DEFAULT 'none' NOT NULL,
	"verification_status" text DEFAULT 'needs_verification' NOT NULL,
	"topic" text,
	"explanation" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'questions' NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"questions_found" integer DEFAULT 0 NOT NULL,
	"key_answers_found" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gradable_count" integer DEFAULT 0 NOT NULL,
	"max_marks" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempts_test_idx" ON "attempts" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "questions_hash_idx" ON "questions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "questions_source_idx" ON "questions" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "questions_status_idx" ON "questions" USING btree ("verification_status");