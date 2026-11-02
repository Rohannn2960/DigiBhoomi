const { recordAuditEvent } = require('../services/audit');

function getEffectiveLimit(envVar, defaultProdLimit, defaultTestLimit = 10000) {
  if (process.env[envVar] !== undefined && process.env[envVar] !== '') {
    return parseInt(process.env[envVar], 10);
  }
  const isTest = (process.env.NODE_ENV || '').toLowerCase() === 'test' ||
    process.env.RATE_LIMIT_TEST_MODE === 'true';
  return isTest ? defaultTestLimit : defaultProdLimit;
}

function createRateLimiter({ limit, windowMs, action, audit = recordAuditEvent }) {
  const clients = new Map();

  return function rateLimit(request, response, next) {
    const maxLimit = typeof limit === 'function' ? limit() : limit;
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let entry = clients.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs, auditRecorded: false };
      clients.set(key, entry);
    }

    if (entry.count >= maxLimit) {
      if (!entry.auditRecorded) {
        entry.auditRecorded = true;
        audit({
          action: `${action}_RATE_LIMITED`,
          resourceType: 'AUTHENTICATION',
          outcome: 'DENIED',
          metadata: { windowMs, limit: maxLimit }
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
  limit: () => getEffectiveLimit('LOGIN_RATE_LIMIT', 30, 10000),
  windowMs: 15 * 60 * 1000,
  action: 'LOGIN'
});

const registrationRateLimit = createRateLimiter({
  limit: () => getEffectiveLimit('REGISTRATION_RATE_LIMIT', 10, 10000),
  windowMs: 60 * 60 * 1000,
  action: 'REGISTRATION'
});

module.exports = { createRateLimiter, loginRateLimit, registrationRateLimit };
