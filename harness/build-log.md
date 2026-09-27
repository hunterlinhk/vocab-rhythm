# OEWN production import status

- Latest main before this checkpoint: `ac6917b`.
- Production import is not run. No database connection was attempted and no production data changed.
- Credential check: local environment has only Supabase project ID, URL, and publishable keys; GitHub repository secrets/variables and environments contain no entries. No full-write Postgres migration URL is available locally. `psql` is also not installed.
- Required next action: configure a direct production Postgres migration connection in the local environment as `LOVABLE_DB_MIGRATION_URL`, with SELECT/INSERT/UPDATE access to `lexemes`, `lexicon_sources`, and `lexicon_entries`. Do not send the connection string in chat. After it is present, resume with read-only pilot/schema/hash checks, backup, then guarded import.
- Current production bundle manifest import SQL SHA-256: `4aec6a2239e6b0dc1c11a6ea2303a8e49ca2f622c32eee6115661528b9549c4c` (3,209,605 bytes). Rollback SQL SHA-256: `eebaebe97e2c9b98ecfdfeaec53d51e7651a3c017d02a745c01c13958e5b7ca0` (2,550 bytes).
- Expected import totals remain 2,742 OEWN lexemes, 19,028 senses, 26 priority-100 pilot senses, and 19,002 priority-0 senses. Production validation and backup are pending.
