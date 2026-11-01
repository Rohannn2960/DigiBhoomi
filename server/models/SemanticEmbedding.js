const mongoose = require('mongoose');

/**
 * SemanticEmbedding Schema
 * Stores generated vector embeddings and minimal indexing metadata in an isolated collection.
 * Leaves Document.js completely untouched.
 *
 * Per architectural requirements:
 * - Does not use contentHash or SHA-256. Unchanged content detection is performed
 *   by comparing normalized searchableText directly.
 * - Stores accessControl mirror for fast and secure authorization filtering.
 */
const SemanticEmbeddingSchema = new mongoose.Schema({
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
    unique: true,
    index: true
  },
  embedding: {
    type: [Number],
    required: true
  },
  model: {
    type: String,
    default: 'Xenova/multilingual-e5-base',
    index: true
  },
  dimensions: {
    type: Number,
    default: 768
  },
  modelVersion: {
    type: String,
    default: '1.0'
  },
  searchableText: {
    type: String,
    required: true
  },
  fieldSnippets: {
    ownerName: { type: String, default: '' },
    surveyNumber: { type: String, default: '' },
    khasraNumber: { type: String, default: '' },
    khataNumber: { type: String, default: '' },
    village: { type: String, default: '' },
    tehsil: { type: String, default: '' },
    district: { type: String, default: '' },
    landClassification: { type: String, default: '' },
    landArea: { type: String, default: '' }
  },
  accessControl: {
    uploadedBy: { type: String, default: null },
    isPrivate: { type: Boolean, default: false }
  },
  metadata: {
    originalFilename: { type: String, default: '' },
    status: { type: String, default: '' }
  },
  indexedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'semantic_embeddings'
});

SemanticEmbeddingSchema.index({ model: 1, dimensions: 1 });

module.exports = mongoose.model('SemanticEmbedding', SemanticEmbeddingSchema);
