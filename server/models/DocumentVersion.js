const mongoose = require('mongoose');

const CHANGE_TYPES = Object.freeze([
  'INITIAL_UPLOAD',
  'CORRECTION',
  'METADATA_UPDATE',
  'STATUS_CHANGE',
  'DOCUMENT_REPLACEMENT',
  'REVIEW_DECISION',
  'OWNERSHIP_TRANSFER'
]);

const DocumentVersionSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  versionNumber: {
    type: Number,
    required: true,
    min: 1
  },
  changeType: {
    type: String,
    enum: CHANGE_TYPES,
    required: true,
    index: true
  },
  changeReason: {
    type: String,
    default: '',
    maxlength: 2000,
    trim: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  changedByRole: {
    type: String,
    default: null
  },
  changedAt: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  sha256Hash: {
    type: String,
    required: true
  },
  diffs: [{
    field: { type: String, required: true },
    label: { type: String, default: '' },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null }
  }],
  snapshot: {
    fileMetadata: {
      originalFilename: { type: String, required: true },
      storedFilename: { type: String, required: true },
      mimeType: { type: String, required: true },
      sizeBytes: { type: Number, required: true },
      sha256Hash: { type: String, required: true },
      hashAlgorithm: { type: String, default: 'SHA-256' }
    },
    status: { type: String, required: true },
    landDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
    reviewRemarks: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  }
}, {
  timestamps: false,
  versionKey: false
});

// Enforce unique sequential version number per document
DocumentVersionSchema.index({ documentId: 1, versionNumber: 1 }, { unique: true });
DocumentVersionSchema.index({ documentId: 1, changedAt: -1 });

// Immutability: Prevent modifications to historical versions
DocumentVersionSchema.pre('updateOne', function() {
  throw new Error('Historical document versions are immutable and cannot be updated.');
});

DocumentVersionSchema.pre('findOneAndUpdate', function() {
  throw new Error('Historical document versions are immutable and cannot be updated.');
});

DocumentVersionSchema.pre('updateMany', function() {
  throw new Error('Historical document versions are immutable and cannot be updated.');
});

DocumentVersionSchema.pre('deleteOne', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Document versions are append-only and cannot be deleted.');
  }
});

DocumentVersionSchema.pre('findOneAndDelete', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Document versions are append-only and cannot be deleted.');
  }
});

DocumentVersionSchema.pre('deleteMany', function() {
  const options = this.getOptions();
  const filter = this.getFilter();
  if (options?.allowTestCleanup || filter?.documentId?.$in || filter?._id?.$in || filter?.changedBy) {
    return;
  }
  throw new Error('Document versions are append-only and cannot be deleted.');
});

module.exports = mongoose.model('DocumentVersion', DocumentVersionSchema);
module.exports.CHANGE_TYPES = CHANGE_TYPES;
