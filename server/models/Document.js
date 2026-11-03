const mongoose = require('mongoose');

// Reusable sub-schema for individual extracted land fields
const ExtractedFieldSchema = new mongoose.Schema({
  value: { type: String, default: '' },
  rawText: { type: String, default: null },
  rawOcrText: { type: String, default: null },
  confidence: { type: Number, default: null }, // e.g. 0.0 to 1.0 (null for Gemini unless verified)
  confidenceSource: { type: String, default: null }, // e.g., 'GEMINI_MULTIMODAL', 'OCR_ENGINE', 'MANUAL_OVERRIDE'
  isFlagged: { type: Boolean, default: false },
  reviewStatus: {
    type: String,
    enum: ['Unreviewed', 'Accepted', 'Corrected', 'Rejected'],
    default: 'Unreviewed'
  }
}, { _id: false });

const DocumentSchema = new mongoose.Schema({
  fileMetadata: {
    originalFilename: { type: String, required: true },
    storedFilename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256Hash: { type: String, required: true, index: true },
    hashAlgorithm: { type: String, enum: ['SHA-256'], default: 'SHA-256' },
    storagePath: { type: String, required: true } // Internal server path, hidden in toJSON
  },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  integrityVerification: {
    status: {
      type: String,
      enum: ['INTEGRITY_VERIFIED', 'INTEGRITY_FAILED', 'HASH_UNAVAILABLE'],
      default: null
    },
    calculatedHash: { type: String, default: null },
    verifiedAt: { type: Date, default: null }
  },
  status: {
    type: String,
    enum: ['Uploaded', 'Processing', 'Needs review', 'Verified', 'Rejected'],
    default: 'Uploaded',
    index: true
  },
  ocrResult: {
    fullText: { type: String, default: '' },
    detectedLanguage: { type: String, default: null },
    engine: { type: String, default: null }, // e.g. 'Google Gemini', 'EasyOCR'
    model: { type: String, default: null },  // e.g. 'gemini-3.5-flash-lite'
    pageCount: { type: Number, default: 1 },
    meanConfidence: { type: Number, default: null }, // overall OCR confidence from local processing, if available
    processedAt: { type: Date, default: null },
    processingTimeMs: { type: Number, default: null },
    error: { type: String, default: null }
  },
  extractionValidation: {
    score: { type: Number, default: null },
    weights: {
      requiredFields: { type: Number, default: 25 },
      formats: { type: Number, default: 25 },
      ocrSupport: { type: Number, default: 30 },
      consistency: { type: Number, default: 20 }
    },
    categories: { type: mongoose.Schema.Types.Mixed, default: null },
    failedChecks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    reviewReasons: { type: [String], default: [] },
    disclaimer: { type: String, default: null },
    calculatedAt: { type: Date, default: null }
  },
  accessControl: {
    uploadedBy: { type: String, default: null },
    isPrivate: { type: Boolean, default: false }
  },
  assignedOfficer: { type: String, default: null, index: true },
  duplicateDetection: {
    hasPotentialDuplicates: { type: Boolean, default: false },
    duplicateCount: { type: Number, default: 0 },
    matches: [{
      targetDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
      targetFilename: { type: String, default: '' },
      matchType: { type: String, enum: ['EXACT_DUPLICATE', 'POSSIBLE_DUPLICATE'] },
      matchedFields: [{ type: String }],
      explanation: { type: String },
      detectedAt: { type: Date, default: Date.now }
    }],
    lastAnalyzedAt: { type: Date, default: null }
  },
  conflictDetection: {
    hasConflicts: { type: Boolean, default: false },
    conflictCount: { type: Number, default: 0 },
    conflicts: [{
      targetDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
      targetFilename: { type: String, default: '' },
      sharedIdentifiers: [{
        field: { type: String },
        value: { type: String }
      }],
      conflictingFields: [{
        field: { type: String },
        label: { type: String },
        currentValue: { type: String },
        targetValue: { type: String },
        reason: { type: String }
      }],
      explanation: { type: String },
      severity: { type: String, enum: ['WARNING', 'INFO'], default: 'WARNING' },
      detectedAt: { type: Date, default: Date.now }
    }],
    disclaimer: {
      type: String,
      default: 'Cross-record conflicts indicate potential data variances or historical transactions requiring human review. They do not constitute proof of fraud or document invalidity.'
    },
    lastAnalyzedAt: { type: Date, default: null }
  },
  landDetails: {
    ownerName: { type: ExtractedFieldSchema, default: () => ({}) },
    surveyNumber: { type: ExtractedFieldSchema, default: () => ({}) },
    khasraNumber: { type: ExtractedFieldSchema, default: () => ({}) },
    khataNumber: { type: ExtractedFieldSchema, default: () => ({}) },
    area: { type: ExtractedFieldSchema, default: () => ({}) },
    areaUnit: { type: ExtractedFieldSchema, default: () => ({}) },
    landArea: {
      value: { type: String, default: '' },
      unit: { type: String, default: 'Acre' },
      rawText: { type: String, default: null },
      rawOcrText: { type: String, default: null },
      confidence: { type: Number, default: null },
      confidenceSource: { type: String, default: null },
      isFlagged: { type: Boolean, default: false },
      reviewStatus: {
        type: String,
        enum: ['Unreviewed', 'Accepted', 'Corrected', 'Rejected'],
        default: 'Unreviewed'
      }
    },
    village: { type: ExtractedFieldSchema, default: () => ({}) },
    tehsil: { type: ExtractedFieldSchema, default: () => ({}) },
    district: { type: ExtractedFieldSchema, default: () => ({}) },
    landClassification: { type: ExtractedFieldSchema, default: () => ({}) }
  },
  reviewRemarks: { type: String, default: '', maxlength: 2000 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  currentVersion: { type: Number, default: 1, min: 1 }
}, { 
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      if (ret.fileMetadata) {
        ret.fileMetadata.previewUrl = `/api/documents/${ret._id}/file`;
        delete ret.fileMetadata.storagePath; // Never expose raw server filesystem path
      }
      return ret;
    }
  }
});

// Indexes for optimized duplicate and cross-record queries
DocumentSchema.index({ 'landDetails.khasraNumber.value': 1, 'landDetails.district.value': 1 });
DocumentSchema.index({ 'landDetails.surveyNumber.value': 1, 'landDetails.district.value': 1 });
DocumentSchema.index({ 'landDetails.khataNumber.value': 1, 'landDetails.district.value': 1 });

module.exports = mongoose.model('Document', DocumentSchema);
