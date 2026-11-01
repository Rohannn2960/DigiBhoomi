const mongoose = require('mongoose');

const AuditEventSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true,
    enum: [
      'DOCUMENT_UPLOADED',
      'OCR_PROCESSING_COMPLETED',
      'OCR_PROCESSING_FAILED',
      'FIELD_EDITS_SAVED',
      'STATUS_UPDATED',
      'CONFLICT_DETECTION_ANALYZED',
      'INTEGRITY_VERIFIED'
    ]
  },
  actor: {
    id: { type: String, default: null },
    role: { type: String, default: null },
    type: {
      type: String,
      enum: ['USER', 'OFFICER', 'ADMIN', 'SYSTEM', 'ANONYMOUS'],
      default: 'ANONYMOUS'
    }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  outcome: {
    type: String,
    enum: ['SUCCESS', 'FAILURE', 'WARNING'],
    default: 'SUCCESS'
  },
  errorMessage: {
    type: String,
    default: null
  }
}, {
  timestamps: false, // We use strict immutable server timestamp
  versionKey: false
});

// Compound index for fast chronological retrieval of a document's audit trail
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
  // Allow programmatic delete during testing only if explicit flag is passed in options
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
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Audit events are append-only and cannot be deleted via the application API.');
  }
});

module.exports = mongoose.model('AuditEvent', AuditEventSchema);
