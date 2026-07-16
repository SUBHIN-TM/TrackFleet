# TrackFleet — Production Update Guide

How to ship code changes to production, step by step.
(Credentials live in `production-setup.txt` — never committed to git.)

## Production layout

| Thing | Where |
|---|---|
| Live site | https://trackfleet.360turningpoint.com (`/super-admin` · `/admin` · `/guardian` · `/api`) |
| Driver APK | https://trackfleet.360turningpoint.com/downloads/trackfleet-driver.apk |
| VPS | `157.173.122.163` (Ubuntu 24.04) — app at `/var/www/trackfleet-app` |
| API process | PM2, name `tf-api`, port 4004 |
| Database | PostgreSQL 16, db `trackfleet` (nightly backups in `/var/backups/trackfleet`) |
| GitHub | https://github.com/SUBHIN-TM/TrackFleet (branch `master`) |

> ⚠️ `/var/www/trackfleet` (without `-app`) on the VPS is a DIFFERENT, older project. Never touch it.

---

## A. Updating the website / backend (most changes)

Any change to `backend/`, `frontend/admin`, `frontend/super-admin`, `frontend/parent`,
or a new Prisma migration — this is all you do:

### Step 1 — on your PC, in `D:\TrioDev\TrackFleet`

```bash
cd D:\TrioDev\TrackFleet
git add -A
git commit -m "describe your change"
git push origin master
```

### Step 2 — deploy on the server (one command, run from anywhere on your PC)

```bash
ssh root@157.173.122.163 '/var/www/trackfleet-app/deploy.sh'
```

The script automatically does: `git pull` → `npm ci` → **DB migrations** →
rebuild all 3 portals → restart the API → health check.
It ends with `{"ok":true,"db":"up"}` and `✅ deploy complete`.

### Step 3 — verify

- Open https://trackfleet.360turningpoint.com/health → should show `{"ok":true,"db":"up"}`
- Hard-refresh the portal you changed (**Ctrl+Shift+R**) — browsers cache the old bundle.

That's it. Web users need nothing — they get the new version on refresh.

---

## B. Updating the driver mobile app (APK)

Only needed when code in `apps/driver/` changes.

### Step 1 — bump the version, in `D:\TrioDev\TrackFleet\apps\driver`

Edit `app.json` → increase `"version"` (e.g. `1.0.0` → `1.0.1`), and in
`android/app/build.gradle` increase `versionCode` (e.g. `1` → `2`).

### Step 2 — build the APK, in `D:\TrioDev\TrackFleet\apps\driver\android`

```bash
cd D:\TrioDev\TrackFleet\apps\driver\android
./gradlew assembleRelease
```

Output: `app/build/outputs/apk/release/app-release.apk` (takes ~2–5 min after the first build).

### Step 3 — upload to the server, from `D:\TrioDev\TrackFleet`

```bash
cd D:\TrioDev\TrackFleet
scp apps/driver/android/app/build/outputs/apk/release/app-release.apk root@157.173.122.163:/var/www/trackfleet-app/downloads/trackfleet-driver.apk
```

### Step 4 — drivers update their phones

They open the same link again → download → install **over the old app**
(no uninstall; their login survives):
`https://trackfleet.360turningpoint.com/downloads/trackfleet-driver.apk`

> 🔑 **Never lose `apps/driver/android/app/trackfleet-driver.keystore`** (and the
> passwords in `apps/driver/android/gradle.properties`). Updates must be signed
> with this exact keystore or phones will refuse to install over the old app.
> Keep a backup outside the repo — it is gitignored on purpose.

---

## C. Useful server commands

```bash
# Live API logs
ssh root@157.173.122.163 'pm2 logs tf-api --lines 50'

# API status / restart
ssh root@157.173.122.163 'pm2 ls'
ssh root@157.173.122.163 'pm2 restart tf-api'

# Reload nginx after editing /etc/nginx/sites-available/trackfleet-360
ssh root@157.173.122.163 'nginx -t && systemctl reload nginx'

# Manual DB backup right now
ssh root@157.173.122.163 'pg_dump -U trackfleet -h localhost trackfleet | gzip > /var/backups/trackfleet/manual-$(date +%F).sql.gz'
```

## D. Rolling back a bad deploy

```bash
# On the server: go back one commit and redeploy
ssh root@157.173.122.163 'cd /var/www/trackfleet-app && git reset --hard HEAD~1 && ./deploy.sh'
```

(For a DB migration gone wrong, restore last night's dump from `/var/backups/trackfleet` first.)

## E. Quick reference — what needs what

| You changed… | Do |
|---|---|
| Backend API code | A (push + deploy.sh) |
| Any web portal | A (push + deploy.sh) |
| Prisma schema / new migration | A — deploy.sh applies migrations automatically |
| Driver app (`apps/driver`) | B (rebuild APK + upload) |
| nginx config | edit on server, then `nginx -t && systemctl reload nginx` |
| Backend `.env` on server | edit `/var/www/trackfleet-app/backend/.env`, then `pm2 restart tf-api` |
