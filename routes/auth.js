import express from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authenticateJWT, issueToken, getClientIP, revokeSessionToken } from '../security.js';
import { logSecurityEvent } from '../audit.js';

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  keyGenerator: req => getClientIP(req),
  handler: (req, res) => {
    logSecurityEvent({ ip: getClientIP(req), event: 'AUTH_RATE_LIMIT', detail: {} });
    res.status(429).json({ error: 'Too many authentication attempts' });
  },
});

router.post('/token', authLimiter, authenticate, issueToken);
router.post('/logout', authenticateJWT, revokeSessionToken);

export default router;
