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
    storagePath: { type: String, required: true } // Internal server path, hidden in toJSON
  },
  status: {
    type: String,
    enum: ['Uploaded', 'Processing', 'Needs review', 'Verified'],
    default: 'Uploaded',
    index: true
  },
  ocrResult: {
    fullText: { type: String, default: '' },
    detectedLanguage: { type: String, default: null },
    engine: { type: String, default: null }, // e.g. 'Google Gemini', 'EasyOCR'
    model: { type: String, default: null },  // e.g. 'gemini-3.5-flash-lite'
    pageCount: { type: Number, default: 1 },
    processedAt: { type: Date, default: null },
    processingTimeMs: { type: Number, default: null },
    error: { type: String, default: null }
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
  }
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

module.exports = mongoose.model('Document', DocumentSchema);
