# RoutePilot — Shop Route Optimization & Driver Management

A production-grade web application for planning optimised delivery/visit routes across shops, assigning them to drivers, and tracking execution.

## Feature overview

- **Shop management** — full CRUD, search/filter/pagination, soft deletion, bulk CSV import with flexible header mapping, per-row validation, duplicate detection (in-file and against the database), and import summaries. Coordinates can be recovered from embedded Google Maps links.
- **Route optimisation** — pick a starting point (address search, `lat,lng`, or Google Maps link), select shops from a list or the map, and generate an optimised round trip. Distances/times come from the OSRM road network (with an automatic haversine fallback), stop order from a nearest-neighbour + 2-opt/Or-opt TSP solver. Stops can be manually reordered and re-optimised.
- **Driver management** — admin-managed driver accounts with temporary credentials, forced password change on first login, credential resets, deactivation, and history.
- **Driver portal** — assigned route list, mobile-first route runner with per-stop status updates (arrived/done/skip), and one-tap Google Maps navigation.
- **Route sharing** — every route has a secure, non-guessable share link (256-bit token) exposing only navigation-relevant data.
- **Security** — bcrypt password hashing, signed HTTP-only session cookies (JWT, token-version revocation), role-based access control (ADMIN / DRIVER) enforced at the API layer, login rate limiting, audit logging, uniform error handling, and security headers.
- **Email notifications** — driver account creation, route assignment, route status changes, password reset. SMTP is configured purely via environment variables; without SMTP the app logs emails instead of sending.

## Technology

| Concern | Choice | Rationale |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, TypeScript) | One deployable unit for UI + API, mature ecosystem |
| Database | PostgreSQL via Prisma 6 (Neon by default) | Managed, serverless-friendly; pooled + direct URLs |
| Maps | Leaflet + OpenStreetMap tiles | No API key, no vendor lock-in |
| Routing engine | OSRM public API + haversine fallback | Real road distances/times at zero cost; degrades gracefully |
| Optimisation | Nearest-neighbour + 2-opt + Or-opt TSP | Near-optimal for 10–200 stops, verified against brute force in tests |
| Geocoding | Nominatim + Google Maps link parser | Address search and link resolution without billing accounts |
| Auth | bcrypt + jose (HS256 session JWT) | Strong hashing, stateless sessions with revocation |
| Email | Resend HTTP API (SMTP fallback) | Works on serverless; no open SMTP connection needed |

## Getting started (development)

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL + DIRECT_URL (Neon) and AUTH_SECRET
npx prisma migrate deploy # applies migrations to your Postgres database
npm run db:seed           # admin + demo driver + sample shops
npm run dev               # http://localhost:3000
```

Default accounts after seeding (change immediately in any real deployment):

- Admin — `admin@example.com` / `Admin@12345` (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- Driver — `driver@example.com` / `Driver@12345`

## Configuration

All configuration is environment-based — see `.env.example`. Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres **pooled** connection (app runtime). Add `pgbouncer=true` for Neon/PgBouncer. |
| `DIRECT_URL` | Postgres **direct** connection (migrations/DDL). Same host without `-pooler`. |
| `AUTH_SECRET` | 32+ char secret signing session tokens (required) |
| `APP_BASE_URL` | Public URL used in emails and share links |
| `RESEND_API_KEY` | Resend API key. When set, email is sent via Resend's HTTP API. |
| `MAIL_FROM` | Verified sender. Use `onboarding@resend.dev` until you verify a domain. |
| `SMTP_HOST/PORT/USER/PASS/SECURE` | SMTP fallback (used only when `RESEND_API_KEY` is empty) |
| `OSRM_BASE_URL` | Routing engine (point at a self-hosted OSRM for heavy production use) |
| `NOMINATIM_BASE_URL` | Geocoder |

### Email (Resend)

Resend is the default provider. **Important:** until you verify a sending domain in the Resend dashboard, Resend only delivers to your own account email and to `@resend.dev` test addresses, and `MAIL_FROM` must use an address on a verified domain (or `onboarding@resend.dev`). To email real drivers, verify your domain in Resend and set `MAIL_FROM` to an address on it (e.g. `RoutePilot <dispatch@yourdomain.com>`).

## Production deployment

### Option A — Vercel (serverless)

1. Set env vars in the Vercel project: `DATABASE_URL` (pooled, `pgbouncer=true`), `DIRECT_URL`, `AUTH_SECRET`, `APP_BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`.
2. Apply migrations from your machine or a deploy hook: `npx prisma migrate deploy` (uses `DIRECT_URL`).
3. Deploy. Email uses Resend's HTTP API, which works within a serverless function.

### Option B — Container (Docker)

```bash
docker compose up --build -d
```

The container runs `prisma migrate deploy` on boot (via `DIRECT_URL`) and exposes a health check at `/api/health`. Requires an external Postgres — set `DATABASE_URL`/`DIRECT_URL` to Neon or any managed Postgres.

**Backups**: use your Postgres provider's tooling — Neon has point-in-time restore; self-managed Postgres uses `pg_dump` / WAL archiving.

**Note on external services**: the public OSRM/Nominatim demo servers are fine for evaluation and light use; production traffic should point `OSRM_BASE_URL`/`NOMINATIM_BASE_URL` at self-hosted or commercial instances. The app keeps working (with estimated distances) if they are unreachable.

## Testing

```bash
npm run test:unit          # pure logic — no DB or network
npm run test:api           # full API flows against an isolated Postgres schema
npm run test:integration   # live Resend delivery (skips without RESEND_API_KEY)
```

`test:api` provisions an isolated `qa_test` schema on the configured database and drops it afterward, so it never touches app data. It covers the TSP optimiser (validated against brute force), CSV parsing/duplicates, geo utilities, rate limiting, tokens, and full API flows (auth, RBAC, shops, drivers, routes, sharing).

## CSV import format

Headers are matched flexibly (case/spacing-insensitive). Recognised columns: `Name/Party/Shop`, `Address`, `Latitude/Lat`, `Longitude/Lng`, `Contact`, `Phone/Mobile`, `Email`, `Notes`, `Bill No/Ref/Code`, `Google Maps Link`. Rows without valid coordinates are rejected (unless recoverable from a Maps link) and reported in the import summary.
