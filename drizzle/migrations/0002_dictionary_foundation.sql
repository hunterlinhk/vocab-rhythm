CREATE TABLE "dictionary_expression_links" (
	"source_id" text NOT NULL,
	"source_entry_ref" text NOT NULL,
	"expression_norm" text NOT NULL,
	"expression" text NOT NULL,
	"expression_lexeme_id" uuid NOT NULL,
	"attach_to" text NOT NULL,
	"attach_to_norm" text NOT NULL,
	"parent_lexeme_id" uuid,
	"source_rank" integer,
	"wordfreq_zipf" numeric,
	"handling" text NOT NULL,
	CONSTRAINT "dictionary_expression_links_pkey" PRIMARY KEY("source_id","source_entry_ref"),
	CONSTRAINT "dictionary_expression_links_source_norm_unique" UNIQUE("source_id","expression_norm")
);
--> statement-breakpoint
CREATE TABLE "dictionary_headwords" (
	"source_id" text NOT NULL,
	"headword_norm" text NOT NULL,
	"headword" text NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"source_rank" integer NOT NULL,
	"wordfreq_zipf" numeric,
	"is_hyphenated" boolean DEFAULT false NOT NULL,
	"parent_norm" text,
	CONSTRAINT "dictionary_headwords_pkey" PRIMARY KEY("source_id","headword_norm"),
	CONSTRAINT "dictionary_headwords_source_rank_unique" UNIQUE("source_id","source_rank")
);
--> statement-breakpoint
CREATE TABLE "dictionary_source_entries" (
	"source_id" text NOT NULL,
	"source_entry_ref" text NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"phonetic" text DEFAULT '' NOT NULL,
	"definition_raw" text DEFAULT '' NOT NULL,
	"translation_raw" text DEFAULT '' NOT NULL,
	"part_of_speech_raw" text DEFAULT '' NOT NULL,
	"definition_pos_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"translation_pos_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"collins_raw" text DEFAULT '' NOT NULL,
	"oxford_raw" text DEFAULT '' NOT NULL,
	"tag_raw" text DEFAULT '' NOT NULL,
	"bnc_raw" text DEFAULT '' NOT NULL,
	"frq_raw" text DEFAULT '' NOT NULL,
	"bnc_numeric" numeric,
	"frq_numeric" numeric,
	"exchange_raw" text DEFAULT '' NOT NULL,
	"detail_raw" text DEFAULT '' NOT NULL,
	"audio_raw" text DEFAULT '' NOT NULL,
	"source_rank" integer,
	"wordfreq_zipf" numeric,
	CONSTRAINT "dictionary_source_entries_pkey" PRIMARY KEY("source_id","source_entry_ref")
);
--> statement-breakpoint
CREATE TABLE "dictionary_source_forms" (
	"source_id" text NOT NULL,
	"source_entry_ref" text NOT NULL,
	"form_norm" text NOT NULL,
	"form" text NOT NULL,
	"lemma_norm" text NOT NULL,
	"lemma" text NOT NULL,
	"form_type" text NOT NULL,
	"raw_marker" text NOT NULL,
	"lexeme_id" uuid NOT NULL,
	CONSTRAINT "dictionary_source_forms_pkey" PRIMARY KEY("source_id","source_entry_ref","form_norm","form_type","raw_marker")
);
--> statement-breakpoint
CREATE TABLE "dictionary_source_tags" (
	"source_id" text NOT NULL,
	"source_entry_ref" text NOT NULL,
	"tag" text NOT NULL,
	"source_field" text NOT NULL,
	CONSTRAINT "dictionary_source_tags_pkey" PRIMARY KEY("source_id","source_entry_ref","tag","source_field")
);
--> statement-breakpoint
CREATE TABLE "lexicon_documents" (
	"source_id" text NOT NULL,
	"document_key" text NOT NULL,
	"document_type" text NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"parent_lexeme_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"publication_status" text DEFAULT 'published' NOT NULL,
	"source_rank" integer,
	"wordfreq_zipf" numeric,
	"content_json" jsonb NOT NULL,
	CONSTRAINT "lexicon_documents_pkey" PRIMARY KEY("source_id","document_key"),
	CONSTRAINT "lexicon_documents_type_check" CHECK ("lexicon_documents"."document_type" in ('headword', 'expression')),
	CONSTRAINT "lexicon_documents_publication_status_check" CHECK ("lexicon_documents"."publication_status" in ('pending_review', 'approved', 'published', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "lexicon_entries" ADD COLUMN "editorial_data" jsonb;--> statement-breakpoint
ALTER TABLE "dictionary_expression_links" ADD CONSTRAINT "dictionary_expression_links_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_expression_links" ADD CONSTRAINT "dictionary_expression_links_expression_lexeme_id_lexemes_id_fk" FOREIGN KEY ("expression_lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_expression_links" ADD CONSTRAINT "dictionary_expression_links_parent_lexeme_id_lexemes_id_fk" FOREIGN KEY ("parent_lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_headwords" ADD CONSTRAINT "dictionary_headwords_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_headwords" ADD CONSTRAINT "dictionary_headwords_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_source_entries" ADD CONSTRAINT "dictionary_source_entries_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_source_entries" ADD CONSTRAINT "dictionary_source_entries_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_source_forms" ADD CONSTRAINT "dictionary_source_forms_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_source_forms" ADD CONSTRAINT "dictionary_source_forms_entry_fk" FOREIGN KEY ("source_id","source_entry_ref") REFERENCES "public"."dictionary_source_entries"("source_id","source_entry_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_source_tags" ADD CONSTRAINT "dictionary_source_tags_entry_fk" FOREIGN KEY ("source_id","source_entry_ref") REFERENCES "public"."dictionary_source_entries"("source_id","source_entry_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexicon_documents" ADD CONSTRAINT "lexicon_documents_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexicon_documents" ADD CONSTRAINT "lexicon_documents_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexicon_documents" ADD CONSTRAINT "lexicon_documents_parent_lexeme_id_lexemes_id_fk" FOREIGN KEY ("parent_lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dictionary_expression_links_expression_idx" ON "dictionary_expression_links" USING btree ("expression_norm");--> statement-breakpoint
CREATE INDEX "dictionary_expression_links_parent_idx" ON "dictionary_expression_links" USING btree ("parent_lexeme_id");--> statement-breakpoint
CREATE INDEX "dictionary_headwords_lexeme_idx" ON "dictionary_headwords" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "dictionary_source_entries_lexeme_idx" ON "dictionary_source_entries" USING btree ("lexeme_id","source_id");--> statement-breakpoint
CREATE INDEX "dictionary_source_entries_rank_idx" ON "dictionary_source_entries" USING btree ("source_rank");--> statement-breakpoint
CREATE INDEX "dictionary_source_forms_form_idx" ON "dictionary_source_forms" USING btree ("form_norm","source_id");--> statement-breakpoint
CREATE INDEX "dictionary_source_forms_lexeme_idx" ON "dictionary_source_forms" USING btree ("lexeme_id");--> statement-breakpoint
CREATE INDEX "dictionary_source_tags_tag_idx" ON "dictionary_source_tags" USING btree ("tag","source_id");--> statement-breakpoint
CREATE INDEX "lexicon_documents_lexeme_idx" ON "lexicon_documents" USING btree ("lexeme_id","publication_status","priority" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lexicon_documents_parent_idx" ON "lexicon_documents" USING btree ("parent_lexeme_id","publication_status");