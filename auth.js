import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function sign(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name, dialect: user.dialect },
    config.jwtSecret, { expiresIn: config.jwtExpiry }
  );
}

// Verifies JWT from Authorization: Bearer <token>
export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// RBAC: strict role gate. Admin dashboard routes use requireRole('ADMIN').
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
