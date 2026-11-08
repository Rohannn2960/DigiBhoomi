const mongoose = require('mongoose');

/**
 * GeoJSON Geometry Sub-Schema
 * Preserves standard GeoJSON Polygon or MultiPolygon geometries
 * for administrative mandal boundaries in EPSG:4326 (WGS84).
 */
const GeometrySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['Polygon', 'MultiPolygon'],
    required: true
  },
  coordinates: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  }
}, { _id: false });

/**
 * MandalBoundary Schema
 * Represents an official administrative Mandal boundary polygon from TGRAC.
 *
 * Notes:
 * - Uniquely identified by compound key (district, mandal).
 * - Same mandal name can legitimately exist in multiple districts (e.g. Ibrahimpatnam, Balanagar).
 * - Village is intentionally excluded / null as TGRAC Layer 26 does not contain village geometries.
 * - 2dsphere index is intentionally omitted in Phase 1 per design specification.
 */
const MandalBoundarySchema = new mongoose.Schema({
  objectId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  district: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  mandal: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  mandalType: {
    type: String,
    required: true,
    enum: ['Rural Mandal', 'Urban Mandal'],
    trim: true
  },
  revenueDivision: {
    type: String,
    required: true,
    trim: true
  },
  geometry: {
    type: GeometrySchema,
    required: true
  },
  districtTelugu: {
    type: String,
    trim: true,
    default: null
  },
  mandalTelugu: {
    type: String,
    trim: true,
    default: null
  },
  dcode: {
    type: Number,
    default: null
  },
  shapeArea: {
    type: Number,
    default: null
  },
  shapeLength: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

// Enforce compound uniqueness across district and mandal
MandalBoundarySchema.index({ district: 1, mandal: 1 }, { unique: true });

module.exports = mongoose.model('MandalBoundary', MandalBoundarySchema);
