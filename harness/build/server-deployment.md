# Cadence server deployment

## Deployment

- Host: `38.95.75.66`, Debian 13, 2 vCPU, 1.9 GiB RAM, 40 GiB root disk, no swap.
- App source commit deployed: `72d766a6c3c8166ed3fd3c4ab29360f47cce66a8` on `feat/self-hosted-better-auth-postgres`.
- Domain: `coci.ink`; authoritative nameservers are `dns25.hichina.com` and `dns26.hichina.com`. DNS records are `@ A 38.95.75.66` and `www CNAME coci.ink`, both with a 600-second TTL.
- Caddy serves `coci.ink` through `127.0.0.1:3000`; `www.coci.ink` and `38.95.75.66.nip.io` redirect to the apex. `compose.override.yaml` on the server sets `APP_ORIGIN` and `BETTER_AUTH_URL` to `https://coci.ink`; it is excluded from Git. Only the app container was recreated, and the PostgreSQL container ID remained unchanged.
- Security dependencies: `@tanstack/react-start` 1.168.60, `better-auth` 1.7.16, `@tanstack/react-router` 1.170.41, and `@tanstack/router-plugin` 1.168.42. The router error-component type was adjusted for the newer contract.
- Repository `.env` tracking was removed and the file is now ignored; its historical Git objects were not rewritten. Its contents were not inspected. Rotate any credentials that may have been committed there.
- Node app runs in Docker on loopback port 3000. PostgreSQL 17 runs in Docker on the private Compose network with the existing `cadence-postgres` volume. Caddy is active on 80/443 and its config validates.
- HTTPS at `coci.ink` and `www.coci.ink` returns successfully with valid certificates. The apex and auth-session endpoint return 200; HTTP redirects to HTTPS with 308, while `www` and the old nip.io hostname redirect to the apex with 301. TCP 3000/5432 are externally unreachable.
- Server `.env` is root-owned mode 0600. It was not read or copied. No database volume reset or migration was needed for the application fixes.

## Database and verification

- NGSL: 2,809 entries.
- OEWN: 19,028 senses, including 26 pilots.
- Round 2: 88 rows (43 senses and 45 usage notes), all `pending_review` under an `editorial`, `restricted` source; zero published.
- Live email registration/login, guest use and linking, learning, account isolation, review, statistics, and dictionary reads passed.
- The repeated-review fix keeps immutable `user_id` out of updates. A live test advanced a test schedule to revision 2, moved its due date into the future, and cleared the review queue.
- The live review center initially exposed a cache-clear race on authenticated mount. The auth layout now waits until cache handling is complete before mounting account queries; review center loads and shows the empty queue after review.
- All 10 disposable email/guest accounts created during this deployment verification were deleted.
- Local final-source checks: `bun run test` 105/105, `bunx tsc --noEmit`, and `bun run build` passed. The earlier real PostgreSQL E2E passed; the embedded runner was not repeated because the current Windows admin token cannot start it.
- Security redeploy rebuilt only the `app` service with `--no-deps`; domain configuration later recreated only `app`. PostgreSQL retained the same container ID and data volume. Public HTTPS root and Better Auth session endpoints returned 200. No migrations or vocabulary import ran.

## Host resources

- Post-domain app-restart snapshot: 830 MiB RAM used, 1.1 GiB available; no swap.
- Root disk: 7.6 GiB of 40 GiB used (21%).
- App container: 38.29 MiB; PostgreSQL container: 48.06 MiB.

## Owner setup still needed

- Provide a Google OAuth client ID and secret, then configure its authorized callback URL for `https://coci.ink`. OAuth callback login has not been verified without those credentials.
- Rotate any application/database credentials that may have been committed in historical `.env` versions. Purging those blobs requires a coordinated Git history rewrite; none was performed.
- Existing failed `ifup@ens18.service` and `rc-local.service` predate deployment and remain unchanged.

## Recovery

- Rebuild or roll back the app container without removing `cadence-postgres` or altering pending Round 2 rows.
- Do not run the Round 2 editorial rollback for deployment recovery.


