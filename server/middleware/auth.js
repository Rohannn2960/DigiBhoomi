const { SESSION_COOKIE, getSessionUser } = require('../services/auth');
const { recordAuditEvent } = require('../services/audit');

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function routeResourceId(request) {
  return typeof request.params.id === 'string' ? request.params.id : null;
}

async function auditDenied(request, userId = null, action = 'ACCESS_DENIED') {
  try {
    await recordAuditEvent({
      actorId: userId,
      action,
      resourceType: 'API_ROUTE',
      resourceId: routeResourceId(request),
      outcome: 'DENIED',
      metadata: { method: request.method, route: request.route?.path || request.path }
    });
  } catch (error) {
    console.error('[Audit persistence error]', error.message);
  }
}

async function authenticate(request, response, next) {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    const session = await getSessionUser(token);
    if (!session) {
      await auditDenied(request, null, 'UNAUTHENTICATED_REQUEST');
      return response.status(401).json({ error: 'Authentication required.' });
    }
    request.user = session.user;
    request.session = session.session;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireRole(...roles) {
  return async (request, response, next) => {
    if (!request.user) {
      return response.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(request.user.role)) {
      await auditDenied(request, request.user._id, 'ROLE_ACCESS_DENIED');
      return response.status(403).json({ error: 'Insufficient permissions.' });
    }
    return next();
  };
}

function hasDocumentAccess(document, user) {
  if (user.role === 'Admin') return true;
  if (user.role === 'Officer') return document.assignedOfficerId?.toString() === user._id.toString();
  return document.ownerId?.toString() === user._id.toString();
}

async function findAuthorizedDocument(id, user) {
  const Document = require('../models/Document');
  const document = await Document.findById(id);
  if (!document) return null;
  if (!hasDocumentAccess(document, user)) {
    try {
      await recordAuditEvent({
        actorId: user._id,
        action: 'DOCUMENT_ACCESS_DENIED',
        resourceType: 'DOCUMENT',
        resourceId: document._id.toString(),
        outcome: 'DENIED'
      });
    } catch (error) {
      console.error('[Audit persistence error]', error.message);
    }
    return null;
  }
  return document;
}

module.exports = { authenticate, findAuthorizedDocument, hasDocumentAccess, readCookie, requireRole };