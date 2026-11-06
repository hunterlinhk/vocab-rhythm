CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"mode" text DEFAULT 'word' NOT NULL,
	"book_id" text DEFAULT 'core' NOT NULL,
	"word" text NOT NULL,
	"translation" text,
	"correct" boolean DEFAULT true NOT NULL,
	"mistouch" boolean DEFAULT false NOT NULL,
	"typo_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_review" boolean DEFAULT false NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"review_mode" text,
	"counted_for_review" boolean,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"review_session_id" uuid,
	"session_stage" text,
	"time_zone" text,
	"review_word_key" text GENERATED ALWAYS AS (lower(btrim(regexp_replace(regexp_replace(word, '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))) STORED,
	CONSTRAINT "attempts_review_mode_check" CHECK ("attempts"."review_mode" is null or "attempts"."review_mode" in ('recognition', 'spelling')),
	CONSTRAINT "attempts_counted_review_check" CHECK ("attempts"."counted_for_review" is distinct from true or ("attempts"."review_mode" is not null and not "attempts"."skipped")),
	CONSTRAINT "attempts_sentence_not_reviewable_check" CHECK ("attempts"."mode" <> 'sentence' or ("attempts"."review_mode" is null and "attempts"."counted_for_review" is distinct from true)),
	CONSTRAINT "attempts_review_mode_owner_check" CHECK ("attempts"."review_mode" is null or ("attempts"."review_mode" = 'recognition' and "attempts"."mode" = 'memorize') or ("attempts"."review_mode" = 'spelling' and "attempts"."mode" = 'word')),
	CONSTRAINT "attempts_review_stage_owner_check" CHECK ("attempts"."review_mode" is null or ("attempts"."review_mode" = 'recognition' and "attempts"."mode" = 'memorize' and "attempts"."session_stage" in ('context', 'recall')) or ("attempts"."review_mode" = 'spelling' and "attempts"."mode" = 'word' and "attempts"."session_stage" = 'word_spelling')),
	CONSTRAINT "attempts_review_session_check" CHECK ("attempts"."review_mode" is null or "attempts"."review_session_id" is not null),
	CONSTRAINT "attempts_session_stage_check" CHECK ("attempts"."session_stage" is null or ("attempts"."mode" = 'word' and "attempts"."session_stage" = 'word_spelling') or ("attempts"."mode" = 'memorize' and "attempts"."session_stage" in ('context', 'recall', 'spell'))),
	CONSTRAINT "attempts_hint_count_check" CHECK ("attempts"."hint_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_progress" (
	"user_id" text NOT NULL,
	"book_id" text NOT NULL,
	"mode" text DEFAULT 'word' NOT NULL,
	"cursor_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "book_progress_pkey" PRIMARY KEY("user_id","book_id","mode"),
	CONSTRAINT "book_progress_mode_check" CHECK ("book_progress"."mode" in ('word', 'sentence', 'memorize')),
	CONSTRAINT "book_progress_revision_check" CHECK ("book_progress"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lexemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"normalized_word" text NOT NULL,
	"lemma" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexemes_language_normalized_word_unique" UNIQUE("language","normalized_word")
);
--> statement-breakpoint
CREATE TABLE "lexicon_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_entry_ref" text,
	"sense_key" text DEFAULT 'primary' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"translation" text,
	"part_of_speech" text,
	"phonetic" text,
	"definition_en" text,
	"sentence" text,
	"sentence_translation" text,
	"subject" text,
	"verb" text,
	"object" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_type" text DEFAULT 'sense' NOT NULL,
	"sense_role" text DEFAULT 'candidate',
	"publication_status" text DEFAULT 'published' NOT NULL,
	"review_decision" text,
	"related_sense_key" text,
	"usage_note_zh" text,
	CONSTRAINT "lexicon_entries_lexeme_source_sense_unique" UNIQUE("lexeme_id","source_id","sense_key"),
	CONSTRAINT "lexicon_entries_content_type_check" CHECK ("lexicon_entries"."content_type" in ('sense', 'usage_note')),
	CONSTRAINT "lexicon_entries_sense_role_check" CHECK ("lexicon_entries"."sense_role" is null or "lexicon_entries"."sense_role" in ('primary', 'supplementary', 'candidate')),
	CONSTRAINT "lexicon_entries_publication_status_check" CHECK ("lexicon_entries"."publication_status" in ('pending_review', 'approved', 'published', 'rejected')),
	CONSTRAINT "lexicon_entries_review_decision_check" CHECK ("lexicon_entries"."review_decision" is null or "lexicon_entries"."review_decision" in ('propose_primary', 'defer_no_suitable_sense')),
	CONSTRAINT "lexicon_entries_content_shape_check" CHECK (("lexicon_entries"."content_type" = 'sense' and "lexicon_entries"."sense_role" is not null and "lexicon_entries"."usage_note_zh" is null) or ("lexicon_entries"."content_type" = 'usage_note' and "lexicon_entries"."sense_role" is null and "lexicon_entries"."translation" is null and "lexicon_entries"."part_of_speech" is null and "lexicon_entries"."phonetic" is null and "lexicon_entries"."definition_en" is null and "lexicon_entries"."sentence" is null and "lexicon_entries"."sentence_translation" is null and "lexicon_entries"."subject" is null and "lexicon_entries"."verb" is null and "lexicon_entries"."object" is null and "lexicon_entries"."usage_note_zh" is not null))
);
--> statement-breakpoint
CREATE TABLE "lexicon_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"version" text,
	"source_url" text NOT NULL,
	"license_id" text,
	"license_url" text,
	"attribution" text NOT NULL,
	"access_tier" text DEFAULT 'public' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_sha256" text,
	"license_notice" text,
	"transformation" text,
	"source_kind" text DEFAULT 'external' NOT NULL,
	CONSTRAINT "lexicon_sources_access_tier_check" CHECK ("lexicon_sources"."access_tier" in ('public', 'restricted')),
	CONSTRAINT "lexicon_sources_source_kind_check" CHECK ("lexicon_sources"."source_kind" in ('external', 'editorial')),
	CONSTRAINT "lexicon_sources_external_license_required" CHECK ("lexicon_sources"."source_kind" = 'editorial' or ("lexicon_sources"."license_id" is not null and "lexicon_sources"."license_url" is not null)),
	CONSTRAINT "lexicon_sources_sha256_check" CHECK ("lexicon_sources"."source_sha256" is null or "lexicon_sources"."source_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_schedule_decisions" (
	"decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_id" text NOT NULL,
	"word" text NOT NULL,
	"word_key" text NOT NULL,
	"review_mode" text NOT NULL,
	"session_id" uuid NOT NULL,
	"decision_revision" integer NOT NULL,
	"supersedes_decision_id" uuid,
	"learning_day" date NOT NULL,
	"session_outcome" text,
	"effective_inclusion" boolean,
	"is_initial_learning" boolean DEFAULT false NOT NULL,
	"state_advanced" boolean NOT NULL,
	"interval_advanced" boolean NOT NULL,
	"schedule_action" text NOT NULL,
	"decision_reason" text NOT NULL,
	"scheduler_version" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"before_state" jsonb NOT NULL,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_key" text DEFAULT 'shared' NOT NULL,
	CONSTRAINT "review_schedule_decisions_scope_revision_unique" UNIQUE("user_id","scope_key","book_id","word_key","review_mode","session_id","decision_revision"),
	CONSTRAINT "review_schedule_decisions_word_key_check" CHECK ("review_schedule_decisions"."word_key" <> '' and "review_schedule_decisions"."word_key" = lower(btrim(regexp_replace(regexp_replace("review_schedule_decisions"."word", '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))),
	CONSTRAINT "review_schedule_decisions_review_mode_check" CHECK ("review_schedule_decisions"."review_mode" in ('recognition', 'spelling')),
	CONSTRAINT "review_schedule_decisions_revision_check" CHECK ("review_schedule_decisions"."decision_revision" >= 0),
	CONSTRAINT "review_schedule_decisions_outcome_check" CHECK ("review_schedule_decisions"."session_outcome" is null or "review_schedule_decisions"."session_outcome" in ('smooth', 'strained', 'failed')),
	CONSTRAINT "review_schedule_decisions_action_check" CHECK ("review_schedule_decisions"."schedule_action" in ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')),
	CONSTRAINT "review_schedule_decisions_reason_check" CHECK ("review_schedule_decisions"."decision_reason" in ('first_learning', 'normal_growth', 'same_day_repeat', 'failure_reset', 'inclusion_pending', 'excluded_by_choice', 'excluded_by_preference', 'excluded_by_book_setting', 'no_valid_attempts')),
	CONSTRAINT "review_schedule_decisions_scope_key_check" CHECK ("review_schedule_decisions"."scope_key" = 'shared' or ("review_schedule_decisions"."scope_key" like 'book:%' and length("review_schedule_decisions"."scope_key") > 5))
);
--> statement-breakpoint
CREATE TABLE "review_session_results" (
	"user_id" text NOT NULL,
	"book_id" text NOT NULL,
	"word" text NOT NULL,
	"word_key" text NOT NULL,
	"review_mode" text NOT NULL,
	"session_id" uuid NOT NULL,
	"outcome" text,
	"counted_for_review" boolean,
	"final_correct" boolean,
	"had_real_error" boolean DEFAULT false NOT NULL,
	"real_wrong_count" integer DEFAULT 0 NOT NULL,
	"used_hint" boolean DEFAULT false NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"valid_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_id" uuid,
	"completed_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"learning_day" date NOT NULL,
	"source_fingerprint" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_session_results_pkey" PRIMARY KEY("user_id","book_id","word_key","review_mode","session_id"),
	CONSTRAINT "review_session_results_word_key_check" CHECK ("review_session_results"."word_key" <> '' and "review_session_results"."word_key" = lower(btrim(regexp_replace(regexp_replace("review_session_results"."word", '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))),
	CONSTRAINT "review_session_results_review_mode_check" CHECK ("review_session_results"."review_mode" in ('recognition', 'spelling')),
	CONSTRAINT "review_session_results_outcome_check" CHECK ("review_session_results"."outcome" is null or "review_session_results"."outcome" in ('smooth', 'strained', 'failed')),
	CONSTRAINT "review_session_results_real_wrong_count_check" CHECK ("review_session_results"."real_wrong_count" >= 0),
	CONSTRAINT "review_session_results_hint_count_check" CHECK ("review_session_results"."hint_count" >= 0),
	CONSTRAINT "review_session_results_attempt_count_check" CHECK ("review_session_results"."attempt_count" >= 0),
	CONSTRAINT "review_session_results_valid_attempt_count_check" CHECK ("review_session_results"."valid_attempt_count" >= 0),
	CONSTRAINT "review_session_results_revision_check" CHECK ("review_session_results"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "review_states" (
	"user_id" text NOT NULL,
	"word" text NOT NULL,
	"word_key" text NOT NULL,
	"source_book_id" text,
	"review_mode" text NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"interval_seconds" integer,
	"consecutive_correct" integer DEFAULT 0 NOT NULL,
	"total_wrong" integer DEFAULT 0 NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"difficulty" numeric,
	"scheduler_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_attempt_id" uuid,
	"last_session_id" uuid,
	"last_learning_day" date,
	"successful_growth_day" date,
	"pending_action" text DEFAULT 'none' NOT NULL,
	"last_outcome" text,
	"last_decision_reason" text,
	"scheduler_version" text,
	"last_decision_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope_key" text DEFAULT 'shared' NOT NULL,
	CONSTRAINT "review_states_pkey" PRIMARY KEY("user_id","word_key","review_mode","scope_key"),
	CONSTRAINT "review_states_word_key_check" CHECK ("review_states"."word_key" <> '' and "review_states"."word_key" = lower(btrim(regexp_replace(regexp_replace("review_states"."word", '[[:space:]]+', ' ', 'g'), '[‘’]', chr(39), 'g')))),
	CONSTRAINT "review_states_review_mode_check" CHECK ("review_states"."review_mode" in ('recognition', 'spelling')),
	CONSTRAINT "review_states_interval_check" CHECK ("review_states"."interval_seconds" is null or "review_states"."interval_seconds" >= 0),
	CONSTRAINT "review_states_counts_check" CHECK ("review_states"."consecutive_correct" >= 0 and "review_states"."total_wrong" >= 0 and "review_states"."hint_count" >= 0),
	CONSTRAINT "review_states_pending_action_check" CHECK ("review_states"."pending_action" in ('initialize', 'grow', 'hold', 'failure_reset_short', 'none')),
	CONSTRAINT "review_states_outcome_check" CHECK ("review_states"."last_outcome" is null or "review_states"."last_outcome" in ('smooth', 'strained', 'failed')),
	CONSTRAINT "review_states_revision_check" CHECK ("review_states"."revision" >= 0),
	CONSTRAINT "review_states_scope_key_check" CHECK ("review_states"."scope_key" = 'shared' or ("review_states"."scope_key" like 'book:%' and length("review_states"."scope_key") > 5))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_book_review_settings" (
	"user_id" text NOT NULL,
	"book_id" text NOT NULL,
	"include_in_review" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_book_review_settings_pkey" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_book_review_settings_book_id_check" CHECK (btrim("user_book_review_settings"."book_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"daily_goal" integer DEFAULT 20 NOT NULL,
	"active_book" text DEFAULT 'core' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"memorize_spelling" boolean DEFAULT true NOT NULL,
	"strict_spelling" boolean DEFAULT false NOT NULL,
	"include_spelling_in_review" boolean,
	"include_spelling_in_review_first_choice" boolean,
	"share_review_progress" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "word_books" (
	"id" text PRIMARY KEY DEFAULT 'b_' || replace(gen_random_uuid()::text, '-', '') NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text DEFAULT 'custom' NOT NULL,
	"owner_user_id" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_books_source_check" CHECK ("word_books"."source" in ('official', 'custom')),
	CONSTRAINT "word_books_owner_matches_source" CHECK (("word_books"."source" = 'official' and "word_books"."owner_user_id" is null) or ("word_books"."source" = 'custom' and "word_books"."owner_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "word_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"word" text NOT NULL,
	"translation" text,
	"phonetic" text,
	"sentence" text,
	"sentence_translation" text,
	"subject" text,
	"verb" text,
	"object" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"part_of_speech" text,
	"source_rank" integer,
	"source_sfi" numeric,
	"source_frequency_per_million" numeric,
	"lexeme_id" uuid,
	CONSTRAINT "word_entries_book_word_unique" UNIQUE("book_id","word")
);
--> statement-breakpoint
CREATE TABLE "word_mastery" (
	"user_id" text NOT NULL,
	"word" text NOT NULL,
	"book_id" text DEFAULT 'core' NOT NULL,
	"translation" text,
	"context_ok" boolean DEFAULT false NOT NULL,
	"recall_ok" boolean DEFAULT false NOT NULL,
	"spell_ok" boolean DEFAULT false NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"reinforced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_mastery_pkey" PRIMARY KEY("user_id","book_id","word")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_progress" ADD CONSTRAINT "book_progress_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexicon_entries" ADD CONSTRAINT "lexicon_entries_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexicon_entries" ADD CONSTRAINT "lexicon_entries_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedule_decisions" ADD CONSTRAINT "review_schedule_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_schedule_decisions" ADD CONSTRAINT "review_schedule_decisions_supersedes_fkey" FOREIGN KEY ("supersedes_decision_id") REFERENCES "public"."review_schedule_decisions"("decision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session_results" ADD CONSTRAINT "review_session_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_session_results" ADD CONSTRAINT "review_session_results_last_attempt_id_attempts_id_fk" FOREIGN KEY ("last_attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_last_attempt_id_attempts_id_fk" FOREIGN KEY ("last_attempt_id") REFERENCES "public"."attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_last_decision_id_review_schedule_decisions_decision_id_fk" FOREIGN KEY ("last_decision_id") REFERENCES "public"."review_schedule_decisions"("decision_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_review_settings" ADD CONSTRAINT "user_book_review_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_books" ADD CONSTRAINT "word_books_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_entries" ADD CONSTRAINT "word_entries_book_id_word_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."word_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_entries" ADD CONSTRAINT "word_entries_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_mastery" ADD CONSTRAINT "word_mastery_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "assistant_messages_user_idx" ON "assistant_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "attempts_user_created_idx" ON "attempts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attempts_user_book_word_idx" ON "attempts" USING btree ("user_id","book_id","word","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attempts_stats_recent_idx" ON "attempts" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "attempts"."skipped" = false;--> statement-breakpoint
CREATE INDEX "attempts_review_session_idx" ON "attempts" USING btree ("user_id","review_word_key","review_mode","review_session_id","created_at","id") WHERE "attempts"."review_session_id" is not null;--> statement-breakpoint
CREATE INDEX "lexicon_entries_lexeme_priority_idx" ON "lexicon_entries" USING btree ("lexeme_id","priority" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lexicon_entries_publication_lookup_idx" ON "lexicon_entries" USING btree ("lexeme_id","publication_status","content_type","sense_role","priority" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_schedule_decisions_replay_idx" ON "review_schedule_decisions" USING btree ("user_id","word_key","review_mode","learning_day","created_at");--> statement-breakpoint
CREATE INDEX "review_session_results_replay_idx" ON "review_session_results" USING btree ("user_id","word_key","review_mode","completed_at","book_id","session_id");--> statement-breakpoint
CREATE INDEX "review_session_results_book_replay_idx" ON "review_session_results" USING btree ("user_id","book_id","word_key","review_mode","completed_at","session_id");--> statement-breakpoint
CREATE INDEX "review_states_due_idx" ON "review_states" USING btree ("user_id","review_mode","next_due_at") WHERE "review_states"."next_due_at" is not null;--> statement-breakpoint
CREATE INDEX "review_states_scoped_due_idx" ON "review_states" USING btree ("user_id","review_mode","scope_key","next_due_at") WHERE "review_states"."next_due_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_unique" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "word_books_owner_idx" ON "word_books" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "word_entries_book_pos_idx" ON "word_entries" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "word_entries_lexeme_idx" ON "word_entries" USING btree ("lexeme_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cadence_link_word_entry_lexeme()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
DECLARE
  word_key text := lower(btrim(NEW.word));
BEGIN
  IF word_key = '' THEN RAISE EXCEPTION 'word must not be blank'; END IF;
  INSERT INTO public.lexemes (language, normalized_word, lemma)
  VALUES ('en', word_key, btrim(NEW.word))
  ON CONFLICT (language, normalized_word) DO NOTHING;
  SELECT id INTO NEW.lexeme_id
  FROM public.lexemes
  WHERE language = 'en' AND normalized_word = word_key;
  RETURN NEW;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER word_entries_link_lexeme
BEFORE INSERT OR UPDATE OF word ON public.word_entries
FOR EACH ROW EXECUTE FUNCTION public.cadence_link_word_entry_lexeme();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cadence_sync_word_count()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
DECLARE
  book_key text := COALESCE(NEW.book_id, OLD.book_id);
BEGIN
  UPDATE public.word_books
  SET word_count = (SELECT count(*)::integer FROM public.word_entries WHERE book_id = book_key),
      updated_at = now()
  WHERE id = book_key;
  RETURN NULL;
END;
$body$;
--> statement-breakpoint
CREATE TRIGGER word_entries_count
AFTER INSERT OR DELETE ON public.word_entries
FOR EACH ROW EXECUTE FUNCTION public.cadence_sync_word_count();
