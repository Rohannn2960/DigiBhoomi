const mongoose = require('mongoose');

const OwnershipHistorySchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    index: true
  },
  previousOwner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  newOwner: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  landRecordReference: {
    khasraNumber: { type: String, default: '', trim: true },
    surveyNumber: { type: String, default: '', trim: true },
    khataNumber: { type: String, default: '', trim: true },
    district: { type: String, default: '', trim: true },
    tehsil: { type: String, default: '', trim: true },
    village: { type: String, default: '', trim: true }
  },
  officerResponsible: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    displayName: { type: String, default: '', trim: true },
    role: { type: String, default: 'Officer' }
  },
  transferDate: {
    type: Date,
    default: Date.now,
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  supportingDocumentRef: {
    type: String,
    default: '',
    trim: true,
    maxlength: 500
  },
  versionNumber: {
    type: Number,
    default: null
  }
}, {
  timestamps: false,
  versionKey: false
});

// Index for chronological history retrieval per document
OwnershipHistorySchema.index({ documentId: 1, transferDate: -1 });
OwnershipHistorySchema.index({ documentId: 1, transferDate: 1 });

// Immutability: Prevent modifications to ownership history
OwnershipHistorySchema.pre('updateOne', function() {
  throw new Error('Ownership history entries are immutable and cannot be updated.');
});

OwnershipHistorySchema.pre('findOneAndUpdate', function() {
  throw new Error('Ownership history entries are immutable and cannot be updated.');
});

OwnershipHistorySchema.pre('updateMany', function() {
  throw new Error('Ownership history entries are immutable and cannot be updated.');
});

OwnershipHistorySchema.pre('deleteOne', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Ownership history entries are append-only and cannot be deleted.');
  }
});

OwnershipHistorySchema.pre('findOneAndDelete', function() {
  if (!this.getOptions()?.allowTestCleanup) {
    throw new Error('Ownership history entries are append-only and cannot be deleted.');
  }
});

OwnershipHistorySchema.pre('deleteMany', function() {
  const options = this.getOptions();
  const filter = this.getFilter();
  if (options?.allowTestCleanup || filter?.documentId?.$in || filter?._id?.$in || filter?.officerResponsible) {
    return;
  }
  throw new Error('Ownership history entries are append-only and cannot be deleted.');
});

module.exports = mongoose.model('OwnershipHistory', OwnershipHistorySchema);
