# TrackFleet Driver (mobile)

A React Native (Expo) app for drivers. They sign in with **Org ID + Driver ID + password** — no email. These three values are created and handed out by the org admin in the admin portal (Drivers → the key icon → *Sign-in details*).

## Why Expo Go does NOT work

Scanning the `npm start` QR with **Expo Go** will always fail. Expo Go ships a
fixed set of native modules, and this app needs two it does not have:

- `@maplibre/maplibre-react-native` — the trip map (`src/TripMap.jsx`)
- background location (`expo-location` + `expo-task-manager`) — the whole point
  of the app; `Location.startLocationUpdatesAsync` is unavailable in Expo Go

Expo Go also only supports the newest SDK, while this app is pinned to SDK 54,
so a fresh Expo Go rejects the QR outright with an "incompatible" message.

The app therefore runs as a **development build**: your own build of the app,
installed once on the phone, that then behaves exactly like Expo Go — same QR,
same fast refresh — but with this project's native modules compiled in.

## Prerequisites

- Node.js (already installed for the backend)
- Android Studio + the Android SDK, and **JDK 17** (`java -version`)
- A phone with **USB debugging** enabled, plugged in (`adb devices` must list
  it), or a running Android emulator
- The TrackFleet backend running (`npm run dev:api`, port **4004**) if you point
  the app at your PC instead of production

## 1. Point the app at your backend

`src/config.js` ships pointing at production:

```js
export const API_URL = 'https://trackfleet.360turningpoint.com';
```

For local dev, set it to your PC's LAN IP — a phone is not the same machine as
your PC, so `localhost` means the phone:

```js
export const API_URL = 'http://192.168.1.23:4004'; // <- your PC's IPv4
```

Find your IPv4 with `ipconfig` (Windows). Phone and PC must be on the **same
Wi-Fi**. An Android emulator can instead use `http://10.0.2.2:4004`.

## 2. Build the dev build (once per machine/phone)

```bash
cd apps/driver
npm install
npm run android      # expo run:android — compiles and installs on the device
```

The first build takes several minutes (Gradle downloads). It installs
**TrackFleet Driver** on the phone and starts Metro automatically.

## 3. Day-to-day: `npm start`

Once the dev build is installed, this is the everyday command:

```bash
cd apps/driver
npm start            # expo start --dev-client
```

Open **TrackFleet Driver** on the phone and scan the QR (or press `a` in the
terminal). Fast refresh works as usual. Repeat `npm run android` only when a
native dependency changes — JS-only changes just need `npm start`.

If the phone cannot reach Metro over Wi-Fi (guest networks, AP isolation):

```bash
npm run start:tunnel
```

## Shipping an APK

```bash
npm run build:apk    # -> android/app/build/outputs/apk/release/app-release.apk
```

## 4. Sign in


Use a driver you created in the admin portal, e.g.:

```
Org ID     TF-INTERVAL
Driver ID  DRV-01
Password   (from the Sign-in details panel)
```

If the admin set the account to require a password change, the app shows a "Set your password" screen on first sign-in; otherwise it goes straight to the home screen.

## What's here

- **Login** — Org ID + Driver ID + password → `POST /api/auth/login`
- **Set password** (only if required) → `POST /api/auth/set-password`
- **Home** — confirms the session; trip assignments & live tracking come next
- Session token is stored on-device (AsyncStorage) and restored on next launch

## Notes

- **Expo Go is not supported** — see the section at the top. Use `npm run android` once, then `npm start`.
- For a store build later, use `eas build` (Expo Application Services).
