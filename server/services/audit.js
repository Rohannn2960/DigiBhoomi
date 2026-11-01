const AuditEvent = require('../models/AuditEvent');

async function recordAuditEvent({ actorId = null, action, resourceType, resourceId = null, outcome, metadata = {} }) {
  return AuditEvent.create({ actorId, action, resourceType, resourceId, outcome, metadata });
}

module.exports = { recordAuditEvent };