#!/usr/bin/env node
/**
 * DigiBhoomi - TGRAC Mandal Boundaries Database Ingestion Script
 * ==============================================================
 *
 * Reads `server/data/telangana_mandal_boundaries.geojson` and idempotently
 * seeds/upserts official Telangana Mandal administrative boundaries into
 * the `mandalboundaries` MongoDB collection.
 *
 * Requirements:
 * - Validates FeatureCollection structure and required properties.
 * - Preserves Polygon and MultiPolygon geometries in EPSG:4326.
 * - Normalizes district and mandal values.
 * - Idempotent: repeated runs produce 0 duplicate records and report unchanged counts.
 * - Does not delete or mutate any existing application collections.
 * - Never runs automatically on server start.
 *
 * Usage:
 *   node server/scripts/seed_mandal_boundaries.js
 *   node server/scripts/seed_mandal_boundaries.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Load environment variables from server/.env if present
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MandalBoundary = require('../models/MandalBoundary');

const DEFAULT_GEOJSON_PATH = path.resolve(__dirname, '..', 'data', 'telangana_mandal_boundaries.geojson');
const DEFAULT_METADATA_PATH = path.resolve(__dirname, '..', 'data', 'telangana_mandal_boundaries_metadata.json');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';
const EXPECTED_FEATURE_COUNT = 621;

/**
 * Validates a single feature for required attributes and valid GeoJSON geometry.
 * Returns { valid: boolean, error?: string, data?: object }
 */
function validateFeature(feature, index) {
  if (!feature || typeof feature !== 'object') {
    return { valid: false, error: `Feature at index ${index} is not an object` };
  }

  const properties = feature.properties;
  if (!properties || typeof properties !== 'object') {
    return { valid: false, error: `Feature index ${index} missing properties object` };
  }

  const objectId = Number(properties.OBJECTID);
  if (!Number.isInteger(objectId) || objectId <= 0) {
    return { valid: false, error: `Feature index ${index} invalid OBJECTID: ${properties.OBJECTID}` };
  }

  const district = typeof properties.District === 'string' ? properties.District.trim() : '';
  if (!district) {
    return { valid: false, error: `Feature OID ${objectId} missing or empty District` };
  }

  const mandal = typeof properties.Mandal === 'string' ? properties.Mandal.trim() : '';
  if (!mandal) {
    return { valid: false, error: `Feature OID ${objectId} missing or empty Mandal` };
  }

  const mandalType = typeof properties.Mandal_Type === 'string' ? properties.Mandal_Type.trim() : '';
  if (!['Rural Mandal', 'Urban Mandal'].includes(mandalType)) {
    return { valid: false, error: `Feature OID ${objectId} invalid Mandal_Type: '${mandalType}'` };
  }

  const revenueDivision = typeof properties.Revenue_Division === 'string' ? properties.Revenue_Division.trim() : '';
  if (!revenueDivision) {
    return { valid: false, error: `Feature OID ${objectId} missing or empty Revenue_Division` };
  }

  const geometry = feature.geometry;
  if (!geometry || typeof geometry !== 'object') {
    return { valid: false, error: `Feature OID ${objectId} missing geometry object` };
  }

  const geomType = geometry.type;
  if (!['Polygon', 'MultiPolygon'].includes(geomType)) {
    return { valid: false, error: `Feature OID ${objectId} unsupported geometry type: ${geomType}` };
  }

  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return { valid: false, error: `Feature OID ${objectId} empty coordinates array` };
  }

  // Validate polygon rings closure and coordinate structure
  const polygonParts = geomType === 'Polygon' ? [coordinates] : coordinates;
  for (let pIdx = 0; pIdx < polygonParts.length; pIdx++) {
    const rings = polygonParts[pIdx];
    if (!Array.isArray(rings) || rings.length === 0) {
      return { valid: false, error: `Feature OID ${objectId} part ${pIdx} has no coordinate rings` };
    }
    for (let rIdx = 0; rIdx < rings.length; rIdx++) {
      const ring = rings[rIdx];
      if (!Array.isArray(ring) || ring.length < 4) {
        return { valid: false, error: `Feature OID ${objectId} ring ${rIdx} has fewer than 4 coordinates` };
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        return { valid: false, error: `Feature OID ${objectId} ring ${rIdx} is not closed: [${first}] != [${last}]` };
      }
    }
  }

  return {
    valid: true,
    data: {
      objectId,
      district,
      mandal,
      mandalType,
      revenueDivision,
      geometry: {
        type: geomType,
        coordinates
      },
      districtTelugu: typeof properties.District_Telugu === 'string' ? properties.District_Telugu.trim() : null,
      mandalTelugu: typeof properties.Mandal_Telugu === 'string' ? properties.Mandal_Telugu.trim() : null,
      dcode: properties.DCODE != null ? Number(properties.DCODE) : null,
      shapeArea: properties.SHAPE_Area != null ? Number(properties.SHAPE_Area) : null,
      shapeLength: properties.SHAPE_Length != null ? Number(properties.SHAPE_Length) : null
    }
  };
}

/**
 * Deep compares two geometry coordinate structures for equality.
 */
function areCoordinatesEqual(c1, c2) {
  if (c1 === c2) return true;
  if (!Array.isArray(c1) || !Array.isArray(c2)) return false;
  if (c1.length !== c2.length) return false;
  for (let i = 0; i < c1.length; i++) {
    if (Array.isArray(c1[i])) {
      if (!areCoordinatesEqual(c1[i], c2[i])) return false;
    } else if (c1[i] !== c2[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether an existing MandalBoundary document matches the incoming data.
 */
function isDocumentUnchanged(existing, incoming) {
  if (existing.objectId !== incoming.objectId) return false;
  if (existing.mandalType !== incoming.mandalType) return false;
  if (existing.revenueDivision !== incoming.revenueDivision) return false;
  if (existing.districtTelugu !== incoming.districtTelugu) return false;
  if (existing.mandalTelugu !== incoming.mandalTelugu) return false;
  if (existing.dcode !== incoming.dcode) return false;
  if (existing.geometry?.type !== incoming.geometry.type) return false;
  return areCoordinatesEqual(existing.geometry?.coordinates, incoming.geometry.coordinates);
}

/**
 * Main seeding logic.
 * Can be called programmatically by tests or from the CLI.
 */
async function seedMandalBoundaries(options = {}) {
  const geojsonPath = options.geojsonPath || DEFAULT_GEOJSON_PATH;
  const metadataPath = options.metadataPath || DEFAULT_METADATA_PATH;
  const isDryRun = Boolean(options.dryRun);
  const skipHashVerification = Boolean(options.skipHashVerification);

  if (!fs.existsSync(geojsonPath)) {
    throw new Error(`GeoJSON dataset file not found at: ${geojsonPath}`);
  }

  // Verify dataset integrity against metadata before importing
  if (!skipHashVerification) {
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Dataset integrity verification failed: metadata file not found at ${metadataPath}`);
    }
    const metaRaw = fs.readFileSync(metadataPath, 'utf8');
    let metaJson;
    try {
      metaJson = JSON.parse(metaRaw);
    } catch (e) {
      throw new Error(`Dataset integrity verification failed: malformed metadata JSON: ${e.message}`);
    }

    if (!metaJson.geojson_sha256) {
      throw new Error("Dataset integrity verification failed: metadata is missing 'geojson_sha256' field.");
    }

    const fileBytes = fs.readFileSync(geojsonPath);
    const calculatedHash = crypto.createHash('sha256').update(fileBytes).digest('hex');

    if (calculatedHash !== metaJson.geojson_sha256) {
      throw new Error(
        `GeoJSON dataset hash mismatch!\n` +
        `Expected (from metadata): ${metaJson.geojson_sha256}\n` +
        `Calculated:              ${calculatedHash}`
      );
    }
  }

  const raw = fs.readFileSync(geojsonPath, 'utf8');
  let featureCollection;
  try {
    featureCollection = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse GeoJSON file: ${err.message}`);
  }

  if (featureCollection.type !== 'FeatureCollection') {
    throw new Error(`Invalid root GeoJSON type: expected 'FeatureCollection', got '${featureCollection.type}'`);
  }

  const features = featureCollection.features;
  if (!Array.isArray(features)) {
    throw new Error("Invalid GeoJSON: 'features' property is not an array");
  }

  const summary = {
    totalFeatures: features.length,
    validFeatures: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    rejected: 0,
    rejectionReasons: []
  };

  const validEntries = [];
  const seenCombos = new Set();

  for (let idx = 0; idx < features.length; idx++) {
    const result = validateFeature(features[idx], idx);
    if (!result.valid) {
      summary.rejected++;
      summary.rejectionReasons.push(result.error);
      continue;
    }

    const { data } = result;
    const comboKey = `${data.district.toUpperCase()}::${data.mandal.toUpperCase()}`;
    if (seenCombos.has(comboKey)) {
      summary.rejected++;
      summary.rejectionReasons.push(`Duplicate (District, Mandal) in source dataset: ${data.district}, ${data.mandal}`);
      continue;
    }
    seenCombos.add(comboKey);

    summary.validFeatures++;
    validEntries.push(data);
  }

  if (isDryRun) {
    return summary;
  }

  // Ensure unique index is built before performing upsert
  await MandalBoundary.init();

  for (const entry of validEntries) {
    const existing = await MandalBoundary.findOne({
      district: entry.district,
      mandal: entry.mandal
    });

    if (!existing) {
      await MandalBoundary.create(entry);
      summary.inserted++;
    } else if (isDocumentUnchanged(existing, entry)) {
      summary.unchanged++;
    } else {
      // Update with new data
      Object.assign(existing, entry);
      await existing.save();
      summary.updated++;
    }
  }

  // Verify final count and uniqueness
  const finalCount = await MandalBoundary.countDocuments();
  const uniqueDistricts = await MandalBoundary.distinct('district');
  const uniqueMandals = await MandalBoundary.distinct('mandal');

  summary.database = {
    totalInDb: finalCount,
    uniqueDistrictsCount: uniqueDistricts.length,
    uniqueMandalNamesCount: uniqueMandals.length
  };

  return summary;
}

/**
 * Database connection helper with embedded memory fallback for local dev.
 */
async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
    return mongoose.connection;
  } catch (directErr) {
    if (MONGODB_URI.includes('localhost') || MONGODB_URI.includes('127.0.0.1')) {
      console.log('Direct connection to MongoDB failed. Initializing embedded MongoMemoryServer...');
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create();
      const memUri = mongod.getUri();
      await mongoose.connect(memUri);
      return mongoose.connection;
    }
    throw directErr;
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('===============================================================');
  console.log('  DigiBhoomi - TGRAC Mandal Boundaries Database Ingestion');
  console.log('===============================================================');
  console.log(`Source File : ${DEFAULT_GEOJSON_PATH}`);
  console.log(`Target Model: MandalBoundary (collection: mandalboundaries)`);
  console.log(`Mode        : ${isDryRun ? 'DRY RUN (no database writes)' : 'LIVE SEED / UPSERT'}`);
  console.log('Connecting to database...');

  await connectToDatabase();
  console.log('Connected to MongoDB.\n');

  try {
    const startTime = Date.now();
    const summary = await seedMandalBoundaries({ dryRun: isDryRun });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('---------------------------------------------------------------');
    console.log('  Ingestion Summary');
    console.log('---------------------------------------------------------------');
    console.log(`Total Features in Source : ${summary.totalFeatures}`);
    console.log(`Valid Features Evaluated : ${summary.validFeatures}`);
    console.log(`Newly Inserted           : ${summary.inserted}`);
    console.log(`Updated (data changed)   : ${summary.updated}`);
    console.log(`Unchanged (identical)    : ${summary.unchanged}`);
    console.log(`Rejected (malformed)     : ${summary.rejected}`);

    if (summary.rejected > 0) {
      console.log('\nRejection Reasons:');
      summary.rejectionReasons.slice(0, 10).forEach(r => console.log(`  - ${r}`));
    }

    if (!isDryRun && summary.database) {
      console.log('\nDatabase Verification:');
      console.log(`  - Total Records in Collection : ${summary.database.totalInDb}`);
      console.log(`  - Unique Districts            : ${summary.database.uniqueDistrictsCount}`);
      console.log(`  - Unique Mandal Names         : ${summary.database.uniqueMandalNamesCount}`);

      if (summary.database.totalInDb === EXPECTED_FEATURE_COUNT) {
        console.log(`\n✓ Verification SUCCESS: Exactly ${EXPECTED_FEATURE_COUNT} records verified in database.`);
      } else {
        console.warn(`\n⚠ Count Warning: Expected ${EXPECTED_FEATURE_COUNT}, but found ${summary.database.totalInDb}.`);
      }
    }

    console.log(`\nCompleted in ${elapsed}s.`);
    console.log('===============================================================');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[FATAL ERROR]', err);
    process.exit(1);
  });
}

module.exports = {
  validateFeature,
  isDocumentUnchanged,
  seedMandalBoundaries,
  EXPECTED_FEATURE_COUNT,
  DEFAULT_GEOJSON_PATH,
  DEFAULT_METADATA_PATH
};
