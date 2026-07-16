import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';
import { sendOtp } from './mailer.js';
import { ApiError } from './http.js';

export const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
// Codes cost an email to issue, so cap how fast one account can burn them.
const MAX_PER_HOUR = 5;

// Short-lived token that carries "who is mid-flow" between the login, OTP and
// set-password steps, so the client never has to re-send credentials and we
// never trust a userId sent by the browser.
const CHALLENGE_TTL = '15m';

export function signChallenge(user, purpose) {
  return jwt.sign({ userId: user.id, purpose, challenge: true }, process.env.JWT_SECRET, {
    expiresIn: CHALLENGE_TTL,
  });
}

export function readChallenge(token, purpose) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new ApiError(401, 'This session expired — please sign in again');
  }
  if (!payload.challenge || payload.purpose !== purpose) {
    throw new ApiError(401, 'This session expired — please sign in again');
  }
  return payload.userId;
}

// Issues a fresh code, invalidating any earlier unused one for the same purpose
// so only the newest email works.
export async function issueOtp(user, purpose) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.emailOtp.count({
    where: { userId: user.id, purpose, createdAt: { gt: since } },
  });
  if (recent >= MAX_PER_HOUR) {
    throw new ApiError(429, 'Too many codes requested. Please wait a while and try again.');
  }

  await prisma.emailOtp.updateMany({
    where: { userId: user.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  // randomInt is the CSPRNG — Math.random is predictable and must never mint
  // a credential.
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

  await prisma.emailOtp.create({
    data: {
      userId: user.id,
      purpose,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    },
  });

  await sendOtp({ to: user.email, code, purpose, minutes: OTP_TTL_MINUTES });
  return { sent: true };
}

// Spends a code. Every failure path returns the same message so this can't be
// used to probe which accounts or codes exist.
export async function consumeOtp(userId, purpose, code) {
  const otp = await prisma.emailOtp.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const bad = () => new ApiError(400, 'That code is incorrect or has expired');
  if (!otp) throw bad();

  if (otp.expiresAt < new Date()) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    throw bad();
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    throw new ApiError(429, 'Too many incorrect attempts. Request a new code.');
  }

  if (!(await bcrypt.compare(code, otp.codeHash))) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw bad();
  }

  await prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
  return true;
}
