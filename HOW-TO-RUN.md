# How to Run TrackFleet

A step-by-step guide to start the project on your machine.

---

## What runs where

| App | Command | URL | What it is |
|-----|---------|-----|------------|
| **Backend API** | `npm run dev:api` | http://localhost:4004 | The engine (no screen). Every app talks to this. |
| **Super Admin** | `npm run dev:super` | http://localhost:5173 | Your platform console — create/manage schools (green UI). |
| **Admin** | `npm run dev:admin` | http://localhost:5174 | School admin portal — buses, drivers, students, routes (blue UI). |
| **Database viewer** | `npm run db:studio` | http://localhost:5555 | Visual browser for the database tables (optional). |

> The **backend must always be running**, plus whichever website you want to open.

---

## Prerequisites (install once)

1. **Node.js 20+** — check with `node --version`
2. **PostgreSQL 16+** — must be running. This project uses a database named `trackfleet`.

---

## First-time setup (only once)

Open a terminal in the project folder:

```bash
cd D:\TrioDev\TrackFleet
```

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure the backend env** — make sure `backend\.env` exists with your Postgres password:
   ```
   DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/trackfleet?schema=public"
   ```
   (A working `.env` is already set up on this machine.)

3. **Create the database tables**
   ```bash
   npm run db:migrate
   ```

4. **Create your super-admin login**
   ```bash
   npm run db:seed
   ```

---

## Running the apps

You need **one terminal per app** (each command keeps running).

**Terminal 1 — Backend (always needed):**
```bash
cd D:\TrioDev\TrackFleet
npm run dev:api
```
Wait for: `TrackFleet API listening on http://localhost:4004`
Check it: open http://localhost:4004 → you should see a "Backend running successfully" screen.

**Terminal 2 — Super Admin console:**
```bash
cd D:\TrioDev\TrackFleet
npm run dev:super
```
Open http://localhost:5173

**Terminal 3 — School Admin portal:**
```bash
cd D:\TrioDev\TrackFleet
npm run dev:admin
```
Open http://localhost:5174

---

## Login credentials (demo)

**Super Admin** (http://localhost:5173)
- Email: `super@trackfleet.local`
- Password: `admin123`

**School Admin** (http://localhost:5174)
- School ID: `greenvalley`
- Email: `admin@greenvalley.com`
- Password: `secret123`

---

## The typical flow

1. **Super Admin** (5173) → create a school (tenant), set its admin email + password.
2. Hand those credentials to the school.
3. **School Admin** (5174) → log in with the School ID + email + password → add buses, drivers, students, and build routes.

---

## Stopping the apps

- In each terminal, press **Ctrl + C**.
- To force-stop everything at once (Windows): `taskkill /F /IM node.exe`

---

## Troubleshooting

**A page looks blank or broken?**
Do a **hard reload** in the browser: **Ctrl + Shift + R**.
(This clears cached files — the #1 cause of a blank dev page when ports are reused.)

**"password authentication failed" when migrating/seeding?**
Your `backend\.env` `DATABASE_URL` password doesn't match your Postgres password. Fix it there.

**Port already in use?**
Another copy is still running. Stop it: `taskkill /F /IM node.exe`, then start again.

**Can't reach the API from a website?**
Make sure Terminal 1 (`npm run dev:api`) is running — the websites are just faces; the backend does the work.
