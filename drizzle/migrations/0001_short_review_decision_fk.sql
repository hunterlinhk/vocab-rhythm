ALTER TABLE "review_states" DROP CONSTRAINT "review_states_last_decision_id_review_schedule_decisions_decision_id_fk";
--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_last_decision_fk" FOREIGN KEY ("last_decision_id") REFERENCES "public"."review_schedule_decisions"("decision_id") ON DELETE set null ON UPDATE no action;