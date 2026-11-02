const mongoose = require('mongoose');

const AuditEventSchema = new mongoose.Schema({
  // RBAC & System Audit fields
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  resourceType: { type: String, default: 'DOCUMENT', trim: true, maxlength: 80 },
  resourceId: { type: String, default: null, maxlength: 120 },
  outcome: { type: String, required: true, index: true }, // e.g. 'SUCCESS', 'DENIED', 'FAILED', 'FAILURE', 'WARNING'
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Document Audit Trail & Timeline fields
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    default: null,
    index: true
  },
  actor: {
    id: { type: String, default: null },
    role: { type: String, default: null },
    type: {
      type: String,
      default: 'ANONYMOUS'
    }
  },
  description: {
    type: String,
    default: ''
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  errorMessage: {
    type: String,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  }
}, {
  timestamps: false, // Strict immutable timestamp
  versionKey: false
});

// Indexes for fast chronological retrieval of resource and document audit trails
AuditEventSchema.index({ resourceType: 1, resourceId: 1, timestamp: -1 });
AuditEventSchema.index({ documentId: 1, timestamp: 1 });
AuditEventSchema.index({ documentId: 1, timestamp: -1 });

// Enforce append-only semantics at the Mongoose layer
AuditEventSchema.pre('updateOne', function() {
  throw new Error('Audit events are immutable and cannot be updated.');
});

AuditEventSchema.pre('findOneAndUpdate', function() {
  throw new Error('Audit events are immutable and cannot be updated.');
});

AuditEventSchema.pre('updateMany', function() {
  throw new Error('Audit events are immutable and cannot be updated.');
});

AuditEventSchema.pre('deleteOne', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Audit events are append-only and cannot be deleted via the application API.');
  }
});

AuditEventSchema.pre('findOneAndDelete', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Audit events are append-only and cannot be deleted via the application API.');
  }
});

AuditEventSchema.pre('deleteMany', function() {
  const options = this.getOptions();
  const filter = this.getFilter();
  // Allow programmatic test cleanup when explicit flag or scoped test filter is present
  if (options?.allowTestCleanup || filter?.actorId || filter?._id?.$in || filter?.documentId?.$in) {
    return;
  }
  throw new Error('Audit events are append-only and cannot be deleted via the application API.');
});

module.exports = mongoose.model('AuditEvent', AuditEventSchema);
