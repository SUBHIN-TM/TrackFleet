import { verifyToken } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { ApiError, asyncHandler } from '../lib/http.js';

// Reads the Bearer token, reloads the user, and attaches:
//   req.user     — the full user record (minus password)
//   req.tenantId — the tenant this request is scoped to (null for super admin)
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Missing auth token');

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, role: true, tenantId: true, email: true, name: true, status: true },
  });
  if (!user || user.status === 'DISABLED') {
    throw new ApiError(401, 'Account not found or disabled');
  }

  req.user = user;
  req.tenantId = user.tenantId; // GOLDEN RULE: use this to scope every query
  next();
});

// Guard a route to specific roles: authorize('SUPER_ADMIN')
export const authorize = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new ApiError(401, 'Not authenticated');
    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, 'You do not have access to this resource');
    }
    next();
  });

// For tenant-scoped routes: guarantees req.tenantId is set (blocks super admin
// from accidentally hitting tenant endpoints without choosing a tenant).
export const requireTenant = asyncHandler(async (req, _res, next) => {
  if (!req.tenantId) throw new ApiError(400, 'This action requires a tenant context');
  next();
});
