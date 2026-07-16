# TrackFleet Driver (mobile)

A React Native (Expo) app for drivers. They sign in with **Org ID + Driver ID + password** — no email. These three values are created and handed out by the org admin in the admin portal (Drivers → the key icon → *Sign-in details*).

## Prerequisites

- Node.js (already installed for the backend)
- The **Expo Go** app on your phone (App Store / Play Store), _or_ an Android emulator / iOS simulator
- The TrackFleet backend running on your PC (`npm run dev:api`, port **4004**)

## 1. Point the app at your backend

A phone is not the same machine as your PC, so `localhost` won't work. Edit **`src/config.js`** and set `API_URL` to your PC's LAN IP:

```js
export const API_URL = 'http://192.168.1.23:4004'; // <- your PC's IPv4 address
```

Find your IPv4 address with `ipconfig` (Windows). The phone and PC must be on the **same Wi-Fi**.

- Android emulator can instead use `http://10.0.2.2:4004`
- iOS simulator can use `http://localhost:4004`

## 2. Install & run

```bash
cd apps/driver
npm install
npm start
```

Then scan the QR code with Expo Go (Android) or the Camera app (iOS). The app opens on your phone.

## 3. Sign in

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

- This app was scaffolded but **not run/tested in this environment** (no Expo tooling/device here). Run the steps above to verify on a device.
- For a store build later, use `eas build` (Expo Application Services).
