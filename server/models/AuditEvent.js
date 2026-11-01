const mongoose = require('mongoose');

const AuditEventSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, trim: true, maxlength: 100 },
  resourceType: { type: String, required: true, trim: true, maxlength: 80 },
  resourceId: { type: String, default: null, maxlength: 120 },
  outcome: { type: String, enum: ['SUCCESS', 'DENIED', 'FAILED'], required: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

AuditEventSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 });

module.exports = mongoose.model('AuditEvent', AuditEventSchema);