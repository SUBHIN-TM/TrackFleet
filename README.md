# TrackFleet

Multi-tenant **vehicle tracking SaaS** — schools-first, built to expand to hospitals & companies.
Each customer organization is a **tenant**; every row is isolated by `tenantId`.

## What it does
A school admin sets up their buses, routes, stops, and students. Each morning the driver's
mobile app streams live GPS and scans students as they board. Parents watch the bus on a live
map and get "boarded / dropped / no-show" alerts. A **sweep check** blocks the driver from
ending a trip while any student is still marked onboard — the core child-safety feature.

## Apps
| App | Path | Who | Stack |
|-----|------|-----|-------|
| **API** | `backend/` | common backend for all | Node/Express + Prisma + PostgreSQL + Socket.IO |
| **Super Admin** | `frontend/super-admin/` | platform owner (you) | React + Vite + MUI |
| **Admin** | `frontend/admin/` | tenant/school admins | React + Vite + MUI + MapLibre |
| **Parent** | `frontend/parent/` | guardians | React + Vite + MUI |
| **Driver** | `mobile/driver/` | drivers | React Native (GPS + boarding scan) |

## Key rules (do not break)
1. **Tenancy** — every DB query filters by `tenantId`. Super admins are the only users with no tenant.
2. **Append-only** — `TripEvent` and `LocationPoint` are INSERT-only. Never update/delete them.
3. **Schema changes via Prisma migrations only** — never hand-edit the database.
4. **Auth** — email + password for every role (bcrypt-hashed).
5. **Generic naming** — tables use `passenger`/`guardian`/`trip`. Verticals only swap display labels.

## Getting started (backend)
```bash
# 1. Install a local PostgreSQL and create a database named "trackfleet"
# 2. Configure env
cp backend/.env.example backend/.env   # then edit DATABASE_URL + JWT_SECRET

# 3. Install deps (from repo root)
npm install

# 4. Create the database tables
npm run db:migrate

# 5. Run the API
npm run dev:api        # http://localhost:4004/health
```

## Status
🟢 Foundation: repo structure, backend skeleton, database schema.
⬜ Next: auth, tenant CRUD, route builder, trip lifecycle, live map, driver app.

See `docs/` (to be added) for the full spec. The original reference implementation lives in
`../simple-bus-tracking` (read-only reference — not part of this project).
