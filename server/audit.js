const AuditEvent = require('./models/AuditEvent');

/**
 * Sanitizes details before persisting to the audit log:
 * - Recursively strips any keys matching secret/path/token/credential
 * - Suppresses server filesystem paths (e.g. storagePath, uploads/...)
 * - Preserves business-level field changes and diffs
 */
function sanitizeAuditDetails(obj) {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeAuditDetails(item));
  }

  const sanitized = {};
  const sensitiveKeyRegex = /storagepath|password|secret|apikey|credential|token/i;

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeyRegex.test(key)) {
      continue; // Skip sensitive keys entirely
    }

    if (typeof value === 'string') {
      // Check if string contains local server path patterns
      if (/uploads[\\\/]|users[\\\/].+[\\\/]digibhoomi/i.test(value)) {
        sanitized[key] = '[PROTECTED_SERVER_PATH]';
      } else {
        sanitized[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditDetails(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Extracts actor context strictly from authenticated req.user or explicit trusted actor.
 * Never derives identity from spoofable client headers (x-user-id, x-user-role) or body.
 */
function extractActor(req, explicitActor = null) {
  if (explicitActor && typeof explicitActor === 'object') {
    const role = explicitActor.role || null;
    let actorType = explicitActor.type;
    if (!actorType) {
      if (role === 'Officer' || role === 'officer') actorType = 'OFFICER';
      else if (role === 'Admin' || role === 'admin') actorType = 'ADMIN';
      else if (role) actorType = 'USER';
      else actorType = 'ANONYMOUS';
    }
    return {
      id: explicitActor.id ? explicitActor.id.toString() : null,
      role,
      type: actorType
    };
  }

  if (!req || typeof req !== 'object') {
    return { id: null, role: null, type: 'SYSTEM' };
  }

  if (req.user) {
    const role = req.user.role || null;
    let actorType = 'USER';
    if (role === 'Officer' || role === 'officer') actorType = 'OFFICER';
    else if (role === 'Admin' || role === 'admin') actorType = 'ADMIN';
    return {
      id: req.user._id?.toString() || req.user.id || null,
      role,
      type: actorType
    };
  }

  return {
    id: null,
    role: null,
    type: 'ANONYMOUS'
  };
}

/**
 * Computes before/after field changes between previous and updated landDetails.
 */
function computeFieldDiffs(oldDetails = {}, newDetails = {}) {
  const fieldsToCheck = [
    { key: 'ownerName', label: 'Owner Name' },
    { key: 'khasraNumber', label: 'Khasra / Survey Number' },
    { key: 'surveyNumber', label: 'Survey Number' },
    { key: 'khataNumber', label: 'Khata Number' },
    { key: 'landArea', label: 'Land Area' },
    { key: 'district', label: 'District' },
    { key: 'tehsil', label: 'Tehsil' },
    { key: 'village', label: 'Village' },
    { key: 'landClassification', label: 'Land Classification' }
  ];

  const diffs = [];

  for (const { key, label } of fieldsToCheck) {
    let beforeVal = '';
    let afterVal = '';

    if (key === 'landArea') {
      const bObj = oldDetails?.landArea || {};
      const aObj = newDetails?.landArea || {};
      beforeVal = `${bObj.value || ''} ${bObj.unit || ''}`.trim();
      afterVal = `${aObj.value || ''} ${aObj.unit || ''}`.trim();
    } else {
      beforeVal = (typeof oldDetails?.[key]?.value === 'string' ? oldDetails[key].value : (typeof oldDetails?.[key] === 'string' ? oldDetails[key] : '')).trim();
      afterVal = (typeof newDetails?.[key]?.value === 'string' ? newDetails[key].value : (typeof newDetails?.[key] === 'string' ? newDetails[key] : '')).trim();
    }

    if (beforeVal !== afterVal) {
      diffs.push({
        field: key,
        label,
        before: beforeVal || '(empty)',
        after: afterVal || '(empty)'
      });
    }
  }

  return diffs;
}

/**
 * Records an immutable audit event for a document operation.
 * Guarantees server-side generated timestamp and sanitized payload.
 */
async function recordAuditEvent({
  documentId,
  action,
  req = null,
  actor = null,
  description,
  details = {},
  outcome = 'SUCCESS',
  errorMessage = null
}) {
  try {
    const mongoose = require('mongoose');
    const actorInfo = actor || extractActor(req);
    const sanitizedDetails = sanitizeAuditDetails(details);
    const actorId = req?.user?._id || (actorInfo?.id && mongoose.Types.ObjectId.isValid(actorInfo.id) ? actorInfo.id : null);

    const auditEntry = new AuditEvent({
      actorId,
      action,
      resourceType: 'DOCUMENT',
      resourceId: documentId ? documentId.toString() : null,
      documentId,
      actor: actorInfo,
      timestamp: new Date(), // Strict server-side timestamp
      description,
      details: sanitizedDetails,
      metadata: sanitizedDetails,
      outcome,
      errorMessage: errorMessage || null
    });

    return await auditEntry.save();
  } catch (err) {
    console.error('[Audit Logging Error]: Failed to write audit event:', err.message);
    // Return null rather than crashing the primary operational flow
    return null;
  }
}

module.exports = {
  sanitizeAuditDetails,
  extractActor,
  computeFieldDiffs,
  recordAuditEvent
};
