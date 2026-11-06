# Cadence server deployment

## Goal

Deploy the requested self-hosted Cadence branch to `38.95.75.66`, initialize PostgreSQL, configure Node behind Caddy, and verify live account, learning, review, statistics, and dictionary flows.

## Constraints

- Keep Round 2 at 88 `pending_review` rows under an `editorial` source with `restricted` access; never approve or publish it.
- Preserve the existing `cadence-postgres` volume during application redeploys.
- Keep credentials in the root-only server `.env`; do not read, copy, or print that file.
- Keep Google OAuth disabled until the owner provides real client credentials.
- Keep `38.95.75.66.nip.io` as a temporary origin until an owner-controlled domain is configured.
- Leave the unrelated failed `ifup@ens18.service` and `rc-local.service` units unchanged.

## Current checkpoint

- The initial deployment of `f96b272eca6b8467155113da6ae0ab5a23b10e02` is live. The host is Debian 13 with 2 vCPU, 1.9 GiB RAM, a 40 GiB root disk, and no swap.
- Node, PostgreSQL, and Caddy are active. The app listens on `127.0.0.1:3000`; PostgreSQL is container-only. HTTPS returns 200 and HTTP redirects with 308.
- Live account, guest/linking, isolation, learning, statistics, dictionary, and review scheduling passed. The repeated-review correction inserts the owner on create and excludes `user_id` from updates. The review center spinner was traced to the auth layout clearing the query cache on first mount; a local readiness gate defers child queries until cache handling completes.
- `bun run test` passes 105/105; `bunx tsc --noEmit` and `bun run build` pass.
- Database: NGSL 2,809; OEWN 19,028; Round 2 88 (43 senses, 45 notes), all pending and restricted. Current live-test accounts are disposable and must be removed after the review regression.
- Google OAuth credentials and an owner-controlled domain are still outstanding.

## Next actions

1. Commit and push the review-state and initial auth-cache fixes to `feat/self-hosted-better-auth-postgres`.
2. Pull that commit on the server; rebuild and recreate only the app service without changing the PostgreSQL volume or `.env`.
3. Make one review row belonging only to the disposable review test account due; confirm the review center lists it, submit it through the live app, and confirm the schedule advances and the due queue clears.
4. Delete only disposable accounts created by this verification run. Recheck Round 2 state/counts, HTTPS redirect, public port exposure, and host/container resources.
5. Update this file and `harness/build-log.md` with the deployed commit and final observed results.

## Recovery

- Application rollback may use the previous image/source, while retaining the database volume and pending editorial rows.
- Do not remove Docker volumes or run the Round 2 editorial rollback as deployment recovery.