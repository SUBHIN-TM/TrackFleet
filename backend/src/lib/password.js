import { randomInt } from 'node:crypto';

// No 0/O/1/l/I: these get read off a screen and retyped by hand, and an
// ambiguous glyph turns into a support ticket.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// Temporary password emailed to an invited admin. It is single-use in practice:
// `mustChangePassword` forces a replacement before any session is issued.
export function generateTempPassword(length = 12) {
  // randomInt is the CSPRNG. Math.random must never mint a credential.
  return Array.from({ length }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
}
