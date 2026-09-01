import Constants from 'expo-constants';
import { API_URL } from './config';

// ============================================================================
// In-app update check.
//
// This APK is sideloaded, not from the Play Store, so nothing updates it
// automatically — without this a driver would keep running an old build until
// someone phoned them. The server publishes the current version next to the
// APK; the app compares and offers a one-tap download.
// ============================================================================

const VERSION_URL = `${API_URL}/downloads/driver-version.json`;
export const APP_VERSION = Constants.expoConfig?.version || '0.0.0';

// "1.0.10" > "1.0.9" — plain string compare would get that wrong.
function isNewer(remote, local) {
  const a = String(remote).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(local).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

// Returns { ok, available, version, apkUrl, notes } — never throws: a failed
// check must never block a driver from starting their trip. `ok` separates
// "checked, you're current" from "couldn't reach the server", which otherwise
// look identical and leave a driver falsely confident they're up to date.
export async function checkForUpdate() {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`); // bypass any cache
    if (!res.ok) return { ok: false, available: false };
    const v = await res.json();
    return {
      ok: true,
      available: isNewer(v.version, APP_VERSION),
      version: v.version,
      apkUrl: v.apkUrl || `${API_URL}/downloads/trackfleet-driver.apk`,
      notes: v.notes,
    };
  } catch {
    return { ok: false, available: false };
  }
}
