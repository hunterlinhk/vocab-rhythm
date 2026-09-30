# Review state historical repair

The missing states caused by the `0011` source-book foreign key are a finite incident window: from the production application of `0011` until `0013` is applied. The repair is a one-off operator task. Review-page loads, due-queue reads, and ordinary session completion do not run this historical scan.

## Scope and behavior

- Select only `review_session_results` whose `completed_at` is inside the explicitly supplied window (`--from` inclusive, `--until` exclusive).
- Consider only completed sessions that are effectively included in review. Unresolved spelling inclusion remains pending; excluded sessions and results without an outcome do not create state.
- Check `review_states` only for the candidate users, words, and review modes from that window. Do not scan each user's full state table.
- Repair only missing `(user_id, word_key, review_mode)` states. Legacy attempts without complete Review v1 session metadata are never considered.
- Each selected identity is replayed across its complete Review v1 history so its scheduler state and decision revisions remain correct. An unchanged decision fingerprint is not inserted again.
- The task is safe to rerun. If interrupted, already repaired identities have a state and are skipped; an identity whose state write did not finish can be replayed without duplicating unchanged decisions.

`source_book_id` is historical provenance and may refer to a bundled or deleted book. Review identity and due-queue eligibility never depend on the source book still existing.

## Operator procedure

Run this only after confirming that `0013` has been applied. Get the exact start and end timestamps from the production rollout records; use UTC ISO timestamps. First run a dry run and inspect its identity list. Then use `--apply` with a new report path so the affected identities and result counts are retained locally.

```powershell
npm run repair:review-state-projections -- --from "<0011-application-time-utc>" --until "<0013-application-time-utc>" --report .\outputs\review-state-repair-dry-run.json
npm run repair:review-state-projections -- --from "<0011-application-time-utc>" --until "<0013-application-time-utc>" --apply --confirm-0013-applied --report .\outputs\review-state-repair-applied.json
```

Replace both placeholders with the exact deployment window before running; they are intentionally not runnable values. The command uses the server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. Never put their values in command history, a report, or Git. The script uses the Supabase API; it does not run SQL.
