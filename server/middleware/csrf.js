function getAllowedOrigins() {
  return (process.env.CLIENT_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function csrfProtection(request, response, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();

  const origin = request.get('Origin');
  const fetchSite = request.get('Sec-Fetch-Site');
  const allowed = getAllowedOrigins();
  if ((origin && allowed.includes(origin)) || (!origin && fetchSite !== 'cross-site')) return next();

  const { recordAuditEvent } = require('../services/audit');
  recordAuditEvent({
    actorId: request.user?._id || null,
    action: 'CSRF_REQUEST_BLOCKED',
    resourceType: 'API_ROUTE',
    resourceId: request.path,
    outcome: 'DENIED',
    metadata: { method: request.method }
  }).catch(error => console.error('[Audit persistence error]', error.message));

  return response.status(403).json({ error: 'Request origin is not allowed.' });
}

module.exports = { csrfProtection, getAllowedOrigins };