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
| Database | SQLite via Prisma 6 (Postgres-ready schema) | Zero-ops default; swap `datasource` provider + `DATABASE_URL` for Postgres |
| Maps | Leaflet + OpenStreetMap tiles | No API key, no vendor lock-in |
| Routing engine | OSRM public API + haversine fallback | Real road distances/times at zero cost; degrades gracefully |
| Optimisation | Nearest-neighbour + 2-opt + Or-opt TSP | Near-optimal for 10–200 stops, verified against brute force in tests |
| Geocoding | Nominatim + Google Maps link parser | Address search and link resolution without billing accounts |
| Auth | bcrypt + jose (HS256 session JWT) | Strong hashing, stateless sessions with revocation |
| Email | nodemailer | Any SMTP provider via env vars |

## Getting started (development)

```bash
npm install
npx prisma migrate dev   # creates dev.db and applies migrations
npm run db:seed          # admin + demo driver + sample shops
npm run dev              # http://localhost:3000
```

Default accounts after seeding (change immediately in any real deployment):

- Admin — `admin@example.com` / `Admin@12345` (override with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`)
- Driver — `driver@example.com` / `Driver@12345`

## Configuration

All configuration is environment-based — see `.env.example`. Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Prisma connection string |
| `AUTH_SECRET` | 32+ char secret signing session tokens (required) |
| `APP_BASE_URL` | Public URL used in emails and share links |
| `SMTP_HOST/PORT/USER/PASS/SECURE`, `MAIL_FROM` | Email delivery (optional; logged when unset) |
| `OSRM_BASE_URL` | Routing engine (point at a self-hosted OSRM for heavy production use) |
| `NOMINATIM_BASE_URL` | Geocoder |

## Production deployment

```bash
docker compose up --build -d
```

The container applies migrations on boot, stores SQLite data on the `app-data` volume, and exposes a health check at `/api/health`. For horizontal scaling switch to Postgres and a shared rate limiter.

**Backups**: with SQLite, snapshot the `app-data` volume (the DB is a single file); with Postgres use standard `pg_dump`/WAL archiving.

**Note on external services**: the public OSRM/Nominatim demo servers are fine for evaluation and light use; production traffic should point `OSRM_BASE_URL`/`NOMINATIM_BASE_URL` at self-hosted or commercial instances. The app keeps working (with estimated distances) if they are unreachable.

## Testing

```bash
npm test               # unit + integration + API tests (vitest)
```

The suite covers the TSP optimiser (validated against brute force), CSV parsing/duplicates, geo utilities, rate limiting, tokens, and full API flows (auth, RBAC, shops, drivers, routes, sharing) against a scratch database.

## CSV import format

Headers are matched flexibly (case/spacing-insensitive). Recognised columns: `Name/Party/Shop`, `Address`, `Latitude/Lat`, `Longitude/Lng`, `Contact`, `Phone/Mobile`, `Email`, `Notes`, `Bill No/Ref/Code`, `Google Maps Link`. Rows without valid coordinates are rejected (unless recoverable from a Maps link) and reported in the import summary.
