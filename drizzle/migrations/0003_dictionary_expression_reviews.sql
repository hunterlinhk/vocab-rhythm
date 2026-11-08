CREATE TABLE "dictionary_expression_reviews" (
	"source_id" text NOT NULL,
	"expression_norm" text NOT NULL,
	"expression" text NOT NULL,
	"attach_to" text,
	"reason" text NOT NULL,
	"review_json" jsonb NOT NULL,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	CONSTRAINT "dictionary_expression_reviews_pkey" PRIMARY KEY("source_id","expression_norm"),
	CONSTRAINT "dictionary_expression_reviews_status_check" CHECK ("dictionary_expression_reviews"."review_status" in ('pending_review', 'resolved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "dictionary_expression_reviews" ADD CONSTRAINT "dictionary_expression_reviews_source_id_lexicon_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lexicon_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dictionary_expression_reviews_status_idx" ON "dictionary_expression_reviews" USING btree ("review_status","source_id");