const mongoose = require('mongoose');
const AuditEvent = require('../models/AuditEvent');

async function recordAuditEvent({
  actorId = null,
  action,
  resourceType,
  resourceId = null,
  outcome,
  metadata = {},
  documentId = null,
  description = '',
  details = null
}) {
  const resolvedDocId = documentId || (
    resourceType === 'DOCUMENT' && resourceId && mongoose.Types.ObjectId.isValid(resourceId)
      ? new mongoose.Types.ObjectId(resourceId)
      : null
  );

  const payload = {
    actorId,
    action,
    resourceType,
    resourceId: resourceId ? resourceId.toString() : null,
    documentId: resolvedDocId,
    outcome,
    metadata: metadata || {},
    description: description || metadata?.description || '',
    details: details || metadata || {}
  };

  if (actorId) {
    const role = metadata?.role || null;
    let actorType = 'USER';
    if (role === 'Officer' || role === 'officer') actorType = 'OFFICER';
    else if (role === 'Admin' || role === 'admin') actorType = 'ADMIN';

    payload.actor = {
      id: actorId.toString(),
      role,
      type: actorType
    };
  }

  return AuditEvent.create(payload);
}

module.exports = { recordAuditEvent };