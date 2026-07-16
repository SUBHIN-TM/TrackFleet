// ============================================================================
// API base URL for the driver app.
//
// A phone (or emulator) is NOT the same machine as your backend, so
// "localhost" will NOT work here — localhost on the phone means the phone.
// Point this at the dev machine's LAN IP where the backend runs on :4004.
//
//   1. Find your PC's IP:  Windows -> `ipconfig` (IPv4 Address, e.g. 192.168.1.23)
//   2. Make sure the phone and PC are on the SAME Wi-Fi.
//   3. Set it below, e.g.  http://192.168.1.23:4004
//
// Android emulator can use http://10.0.2.2:4004 to reach the host's localhost.
// iOS simulator can use http://localhost:4004.
// In production, set this to your deployed API domain (https://api.example.com).
// ============================================================================
export const API_URL = 'http://172.16.3.95:4004';
