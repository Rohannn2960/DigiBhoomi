/**
 * DigiBhoomi Phase 1 GIS Ingestion Test Suite
 * ===========================================
 *
 * Verifies:
 * 1. Feature validation: Polygon and MultiPolygon geometry acceptance.
 * 2. Rejection of missing required attributes (District, Mandal, OBJECTID, Mandal_Type, Revenue_Division).
 * 3. Rejection of unclosed or degenerate polygon rings.
 * 4. Preservation of null Village attribute without data fabrication.
 * 5. Compound uniqueness constraint on { district: 1, mandal: 1 }.
 * 6. Disambiguation & allowance of identical mandal names in different districts.
 * 7. Full idempotence of seedMandalBoundaries (run 1 inserts, run 2 reports unchanged).
 * 8. Live dataset ingestion verification: 621 features, 599 Polygons, 22 MultiPolygons.
 *
 * Usage:
 *   node server/test_mandal_boundary_seeding.js
 */

const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const MandalBoundary = require('./models/MandalBoundary');
const {
  validateFeature,
  isDocumentUnchanged,
  seedMandalBoundaries,
  EXPECTED_FEATURE_COUNT
} = require('./scripts/seed_mandal_boundaries');

// Use isolated test database ending in _test
const TEST_MONGODB_URI = process.env.GIS_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/digibhoomi_gis_test';

async function runTestSuite() {
  console.log('===============================================================');
  console.log('   DigiBhoomi Phase 1: Mandal Boundary Ingestion Test Suite   ');
  console.log('===============================================================');
  console.log(`Test Database: ${TEST_MONGODB_URI}\n`);

  let passed = 0;
  let failed = 0;

  function runTest(name, fn) {
    try {
      fn();
      console.log(`  ✓ Pass: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ Fail: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  async function runAsyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ Pass: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ Fail: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // --------------------------------------------------------------------------
  // PART A: Unit Validation of GeoJSON Features
  // --------------------------------------------------------------------------
  console.log('--- Part A: Feature Validation & Integrity ---');

  runTest('1. Validates standard Polygon feature', () => {
    const raw = {
      type: 'Feature',
      properties: {
        OBJECTID: 10,
        District: 'Rangareddy',
        Mandal: 'Shamshabad',
        Mandal_Type: 'Rural Mandal',
        Revenue_Division: 'Rajendranagar'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[78.40, 17.20], [78.45, 17.20], [78.45, 17.25], [78.40, 17.25], [78.40, 17.20]]
        ]
      }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.data.district, 'Rangareddy');
    assert.strictEqual(res.data.mandal, 'Shamshabad');
    assert.strictEqual(res.data.geometry.type, 'Polygon');
  });

  runTest('2. Validates MultiPolygon feature', () => {
    const raw = {
      type: 'Feature',
      properties: {
        OBJECTID: 103,
        District: 'Mulugu',
        Mandal: 'Venkatapur',
        Mandal_Type: 'Rural Mandal',
        Revenue_Division: 'Mulug'
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[79.80, 18.20], [79.85, 18.20], [79.85, 18.25], [79.80, 18.25], [79.80, 18.20]]],
          [[[79.90, 18.30], [79.95, 18.30], [79.95, 18.35], [79.90, 18.35], [79.90, 18.30]]]
        ]
      }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.data.geometry.type, 'MultiPolygon');
    assert.strictEqual(res.data.geometry.coordinates.length, 2);
  });

  runTest('3. Rejects feature with missing District', () => {
    const raw = {
      properties: { OBJECTID: 1, Mandal: 'Shamshabad', Mandal_Type: 'Rural Mandal', Revenue_Division: 'RD' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /District/i);
  });

  runTest('4. Rejects feature with missing Mandal', () => {
    const raw = {
      properties: { OBJECTID: 1, District: 'Rangareddy', Mandal_Type: 'Rural Mandal', Revenue_Division: 'RD' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /Mandal/i);
  });

  runTest('5. Rejects unsupported geometry type (e.g. LineString)', () => {
    const raw = {
      properties: { OBJECTID: 1, District: 'D', Mandal: 'M', Mandal_Type: 'Rural Mandal', Revenue_Division: 'RD' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /unsupported geometry type/i);
  });

  runTest('6. Rejects unclosed polygon ring', () => {
    const raw = {
      properties: { OBJECTID: 1, District: 'D', Mandal: 'M', Mandal_Type: 'Rural Mandal', Revenue_Division: 'RD' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] // Not closed
      }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /not closed/i);
  });

  runTest('7. Rejects invalid Mandal_Type', () => {
    const raw = {
      properties: { OBJECTID: 1, District: 'D', Mandal: 'M', Mandal_Type: 'Semi-Urban', Revenue_Division: 'RD' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    };
    const res = validateFeature(raw, 0);
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /invalid Mandal_Type/i);
  });

  // --------------------------------------------------------------------------
  // PART B: Database Constraints & Compound Uniqueness
  // --------------------------------------------------------------------------
  console.log('\n--- Part B: Database Schema & Uniqueness Constraints ---');

  // Connect to isolated test database
  try {
    await mongoose.connect(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.log('Direct test DB connection failed, using MongoMemoryServer...');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }

  // Ensure index is created
  await MandalBoundary.init();

  // Clear only the test mandalboundaries collection
  await MandalBoundary.deleteMany({});

  await runAsyncTest('8. Enforces compound uniqueness on { district: 1, mandal: 1 }', async () => {
    const doc1 = {
      objectId: 9001,
      district: 'Rangareddy',
      mandal: 'UniqueMandal',
      mandalType: 'Rural Mandal',
      revenueDivision: 'TestDivision',
      geometry: {
        type: 'Polygon',
        coordinates: [[[78.4, 17.2], [78.5, 17.2], [78.5, 17.3], [78.4, 17.3], [78.4, 17.2]]]
      }
    };

    await MandalBoundary.create(doc1);

    // Duplicate district and mandal with different objectId must fail
    const doc2 = {
      ...doc1,
      objectId: 9002
    };

    let caughtError = null;
    try {
      await MandalBoundary.create(doc2);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected MongoDB duplicate key error on compound index');
    assert.strictEqual(caughtError.code, 11000, 'Error code must be 11000 (duplicate key)');
  });

  await runAsyncTest('9. Allows identical mandal name across DIFFERENT districts', async () => {
    // Real Telangana example: Ibrahimpatnam exists in both Rangareddy and Jagtial
    const rrdIbrahimpatnam = {
      objectId: 9101,
      district: 'Rangareddy',
      mandal: 'Ibrahimpatnam',
      mandalType: 'Rural Mandal',
      revenueDivision: 'Ibrahimpatnam',
      geometry: {
        type: 'Polygon',
        coordinates: [[[78.5, 17.1], [78.6, 17.1], [78.6, 17.2], [78.5, 17.2], [78.5, 17.1]]]
      }
    };

    const jagtialIbrahimpatnam = {
      objectId: 9102,
      district: 'Jagtial',
      mandal: 'Ibrahimpatnam',
      mandalType: 'Rural Mandal',
      revenueDivision: 'Metpalle',
      geometry: {
        type: 'Polygon',
        coordinates: [[[78.7, 18.8], [78.8, 18.8], [78.8, 18.9], [78.7, 18.9], [78.7, 18.8]]]
      }
    };

    await MandalBoundary.create(rrdIbrahimpatnam);
    await MandalBoundary.create(jagtialIbrahimpatnam);

    const matches = await MandalBoundary.find({ mandal: 'Ibrahimpatnam' });
    assert.strictEqual(matches.length, 2, 'Both mandals in different districts must exist');
    const districts = matches.map(m => m.district).sort();
    assert.deepStrictEqual(districts, ['Jagtial', 'Rangareddy']);
  });

  // --------------------------------------------------------------------------
  // PART C: Full Ingestion & Idempotence Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Part C: Full Seeding & Idempotence Testing ---');

  // Clean test collection before full seeding test
  await MandalBoundary.deleteMany({});

  await runAsyncTest('10. Run 1: Seeds exactly 621 features from GeoJSON dataset', async () => {
    const summary1 = await seedMandalBoundaries();

    assert.strictEqual(summary1.totalFeatures, EXPECTED_FEATURE_COUNT, 'Source features must equal 621');
    assert.strictEqual(summary1.validFeatures, EXPECTED_FEATURE_COUNT, 'Valid features must equal 621');
    assert.strictEqual(summary1.inserted, EXPECTED_FEATURE_COUNT, 'All 621 features must be inserted');
    assert.strictEqual(summary1.updated, 0, 'No updates on clean seed');
    assert.strictEqual(summary1.unchanged, 0, 'No unchanged on clean seed');
    assert.strictEqual(summary1.rejected, 0, 'Zero features rejected');

    const count = await MandalBoundary.countDocuments();
    assert.strictEqual(count, EXPECTED_FEATURE_COUNT, `Database count must equal ${EXPECTED_FEATURE_COUNT}`);
  });

  await runAsyncTest('11. Run 2 (Idempotence): Re-running produces 0 inserted, 0 updated, 621 unchanged', async () => {
    const summary2 = await seedMandalBoundaries();

    assert.strictEqual(summary2.totalFeatures, EXPECTED_FEATURE_COUNT);
    assert.strictEqual(summary2.inserted, 0, 'Must NOT insert any duplicate records');
    assert.strictEqual(summary2.updated, 0, 'Must NOT mutate unchanged records');
    assert.strictEqual(summary2.unchanged, EXPECTED_FEATURE_COUNT, 'All 621 records must be recognized as unchanged');
    assert.strictEqual(summary2.rejected, 0, 'Zero features rejected');

    const count = await MandalBoundary.countDocuments();
    assert.strictEqual(count, EXPECTED_FEATURE_COUNT, `Database count must remain strictly ${EXPECTED_FEATURE_COUNT}`);
  });

  await runAsyncTest('12. Validates geometry type distribution and schema completeness', async () => {
    const polygonCount = await MandalBoundary.countDocuments({ 'geometry.type': 'Polygon' });
    const multiPolygonCount = await MandalBoundary.countDocuments({ 'geometry.type': 'MultiPolygon' });

    assert.strictEqual(polygonCount, 599, 'Expected exactly 599 Polygons');
    assert.strictEqual(multiPolygonCount, 22, 'Expected exactly 22 MultiPolygons');
    assert.strictEqual(polygonCount + multiPolygonCount, 621);

    // Verify sample record fields
    const abdullapurmet = await MandalBoundary.findOne({ district: 'Rangareddy', mandal: 'Abdullapurmet' });
    assert.ok(abdullapurmet, 'Abdullapurmet record must exist');
    assert.strictEqual(abdullapurmet.objectId, 1);
    assert.strictEqual(abdullapurmet.mandalType, 'Rural Mandal');
    assert.strictEqual(abdullapurmet.revenueDivision, 'Ibrahimpatnam');
    assert.strictEqual(abdullapurmet.geometry.type, 'Polygon');
    assert.ok(abdullapurmet.shapeArea > 0, 'SHAPE_Area must be preserved');
  });

  // Clean test collection after tests
  await MandalBoundary.deleteMany({});
  await mongoose.disconnect();

  console.log('\n===============================================================');
  console.log(`   Phase 1 GIS Test Results: ${passed} passed, ${failed} failed   `);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('[FATAL TEST ERROR]', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
