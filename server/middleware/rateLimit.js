const { recordAuditEvent } = require('../services/audit');

function createRateLimiter({ limit, windowMs, action, audit = recordAuditEvent }) {
  const clients = new Map();

  return function rateLimit(request, response, next) {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let entry = clients.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs, auditRecorded: false };
      clients.set(key, entry);
    }

    if (entry.count >= limit) {
      if (!entry.auditRecorded) {
        entry.auditRecorded = true;
        audit({
          action: `${action}_RATE_LIMITED`,
          resourceType: 'AUTHENTICATION',
          outcome: 'DENIED',
          metadata: { windowMs, limit }
        }).catch(error => console.error('[Audit persistence error]', error.message));
      }
      response.set('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))));
      return response.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    entry.count += 1;
    if (clients.size > 10000) {
      for (const [clientKey, clientEntry] of clients) {
        if (clientEntry.expiresAt <= now) clients.delete(clientKey);
      }
    }
    return next();
  };
}

const loginRateLimit = createRateLimiter({
  limit: 30,
  windowMs: 15 * 60 * 1000,
  action: 'LOGIN'
});

const registrationRateLimit = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000,
  action: 'REGISTRATION'
});

module.exports = { createRateLimiter, loginRateLimit, registrationRateLimit };