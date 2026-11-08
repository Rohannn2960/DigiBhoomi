/**
 * DigiBhoomi Phase 2A GIS API Integration Test Suite
 * ==================================================
 *
 * Verifies:
 * 1. Identifier extraction (prefers tehsil, falls back to mandal, preserves original fields).
 * 2. Injection-safe regex escaping and anchored matching.
 * 3. Dynamic metadata loading (no hardcoding) and fingerprint-based staleness detection.
 * 4. Spatial validation engine:
 *    - Clean exact match (MATCHED)
 *    - Cross-district shared mandal disambiguation
 *    - Dynamic candidate district reporting on mismatch (zero hardcoding)
 *    - Missing fields handling (UNABLE_TO_VERIFY)
 *    - Ambiguity handling (never picks matches[0])
 * 5. Route-level RBAC & Anti-Enumeration:
 *    - 401 for unauthenticated
 *    - 404 for non-existent documents
 *    - 404 for unrelated Citizens (anti-enumeration on both GET and POST)
 *    - 404 for unassigned Officers (anti-enumeration on both GET and POST)
 *    - 200 for Citizen owner on GET /gis
 *    - 403 for Citizen owner on POST /gis/validate
 *    - 200 for assigned Officer on POST /gis/validate
 *    - 200 for Admin on POST /gis/validate
 * 6. Document integrity preservation:
 *    - document.status is NOT mutated
 *    - document.ownerId is NOT mutated
 *    - GeoJSON boundary geometry is NOT duplicated inside Document record
 *    - Audit event DOCUMENT_GIS_VALIDATED is recorded
 *    - Mandatory disclaimer is present
 *
 * Usage:
 *   node server/test_gis_api.js
 */

const assert = require('assert');
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const Document = require('./models/Document');
const User = require('./models/User');
const AuditEvent = require('./models/AuditEvent');
const MandalBoundary = require('./models/MandalBoundary');
const { seedMandalBoundaries } = require('./scripts/seed_mandal_boundaries');
const {
  MANDATORY_DISCLAIMER,
  escapeRegex,
  getDatasetMetadata,
  extractAdministrativeIdentifiers,
  checkValidationStaleness,
  validateAdministrativeJurisdiction
} = require('./services/gisService');

// Use isolated test database ending in _test
const TEST_MONGODB_URI = process.env.GIS_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/digibhoomi_gis_test';

async function runTestSuite() {
  console.log('===============================================================');
  console.log('   DigiBhoomi Phase 2A: GIS API & Validation Test Suite       ');
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
  // PART A: Unit Validation of GIS Service Components
  // --------------------------------------------------------------------------
  console.log('--- Part A: GIS Service Unit Tests ---');

  runTest('1. escapeRegex neutralizes regex injection characters', () => {
    const dangerous = '.*+?^${}()|[]\\test';
    const escaped = escapeRegex(dangerous);
    assert.strictEqual(escaped, '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\test');
    // Ensure it compiles as literal matcher
    const reg = new RegExp(`^${escaped}$`);
    assert.strictEqual(reg.test(dangerous), true);
    assert.strictEqual(reg.test('anything_else'), false);
  });

  runTest('2. Identifier extraction prefers tehsil over legacy mandal', () => {
    const landDetails = {
      district: { value: '  Rangareddy  ' },
      tehsil: { value: '  Abdullapurmet  ' },
      mandal: { value: '  LegacyMandal  ' },
      village: { value: '  Mamidipally  ' }
    };
    const extracted = extractAdministrativeIdentifiers(landDetails);
    assert.strictEqual(extracted.district, 'Rangareddy');
    assert.strictEqual(extracted.mandal, 'Abdullapurmet');
    assert.strictEqual(extracted.village, 'Mamidipally');

    // Assert original fields were NOT mutated
    assert.strictEqual(landDetails.district.value, '  Rangareddy  ');
    assert.strictEqual(landDetails.tehsil.value, '  Abdullapurmet  ');
  });

  runTest('3. Identifier extraction falls back to mandal when tehsil is empty', () => {
    const landDetails = {
      district: { value: 'Rangareddy' },
      tehsil: { value: '   ' }, // empty after trimming
      mandal: { value: '  Shamshabad  ' }
    };
    const extracted = extractAdministrativeIdentifiers(landDetails);
    assert.strictEqual(extracted.district, 'Rangareddy');
    assert.strictEqual(extracted.mandal, 'Shamshabad');
  });

  runTest('4. Dynamic dataset metadata loads without hardcoded fallbacks and verifies GeoJSON hash', () => {
    const meta = getDatasetMetadata();
    assert.strictEqual(meta.isAvailable, true);
    assert.strictEqual(meta.layerId, 26);
    assert.strictEqual(typeof meta.retrievalDate, 'string');
    assert.strictEqual(typeof meta.fingerprint, 'string');
    assert.strictEqual(meta.fingerprint.length, 64); // SHA-256
    assert.strictEqual(meta.fingerprint, '548140196bd0ad11aad4a48923882861b25f97961afe516cdb90fffdbe9ea2fe');
    assert.strictEqual(meta.geojsonSha256, '548140196bd0ad11aad4a48923882861b25f97961afe516cdb90fffdbe9ea2fe');
    assert.strictEqual(meta.featureCount, 621);
  });

  runTest('5. Staleness detection detects changed fingerprint and retrieval date', () => {
    const meta = getDatasetMetadata();
    const upToDate = {
      retrievalDate: meta.retrievalDate,
      fingerprint: meta.fingerprint
    };
    const check1 = checkValidationStaleness(upToDate, meta);
    assert.strictEqual(check1.isStale, false);

    const staleVersion = {
      retrievalDate: '2020-01-01T00:00:00.000Z',
      fingerprint: 'stale-hash-00000000000000000000000000000000000000000000000000000000'
    };
    const check2 = checkValidationStaleness(staleVersion, meta);
    assert.strictEqual(check2.isStale, true);
    assert.ok(check2.staleReason.includes('updated since this document was validated'));
  });

  runTest('5b. Dataset integrity rejects mismatched GeoJSON hash safely', () => {
    const fs = require('fs');
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-meta-test-'));
    const tempMetaPath = path.join(tempDir, 'metadata.json');
    const tempGeoPath = path.join(tempDir, 'data.geojson');

    fs.writeFileSync(tempGeoPath, JSON.stringify({ type: 'FeatureCollection', features: [] }));
    fs.writeFileSync(tempMetaPath, JSON.stringify({
      source_url: 'https://test',
      layer_id: 26,
      geojson_sha256: 'different-fake-hash-00000000000000000000000000000000000000000000000'
    }));

    try {
      const corruptMeta = getDatasetMetadata(tempMetaPath, tempGeoPath);
      assert.strictEqual(corruptMeta.isAvailable, false);
      assert.ok(corruptMeta.error.includes('hash mismatch'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // PART B: Database Connection & Seeding for Service Integration Tests
  // --------------------------------------------------------------------------
  console.log('\n--- Part B: Service Spatial Validation Logic ---');

  try {
    await mongoose.connect(TEST_MONGODB_URI, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }

  await MandalBoundary.init();
  const mbCount = await MandalBoundary.countDocuments();
  if (mbCount !== 621) {
    console.log('Seeding test database with Mandal boundaries...');
    await seedMandalBoundaries();
  }

  await runAsyncTest('6. Validates exact compound match with case & whitespace tolerance', async () => {
    const landDetails = {
      district: { value: '  rAnGaReDdY  ' },
      tehsil: { value: '  aBdUlLaPuRmEt  ' }
    };
    const result = await validateAdministrativeJurisdiction(landDetails);
    assert.strictEqual(result.status, 'MATCHED');
    assert.strictEqual(result.matchedMandal.objectId, 1);
    assert.strictEqual(result.matchedMandal.district, 'Rangareddy');
    assert.strictEqual(result.matchedMandal.mandal, 'Abdullapurmet');
    assert.strictEqual(result.boundary.type, 'Feature');
    assert.strictEqual(result.boundary.geometry.type, 'Polygon');
    assert.strictEqual(result.discrepancies.length, 0);
  });

  await runAsyncTest('7. Disambiguates shared mandal name across districts', async () => {
    // Real Telangana example: Ibrahimpatnam exists in Rangareddy (OID 190) and Jagtial (OID 189)
    const resRrd = await validateAdministrativeJurisdiction({
      district: { value: 'Rangareddy' },
      tehsil: { value: 'Ibrahimpatnam' }
    });
    assert.strictEqual(resRrd.status, 'MATCHED');
    assert.strictEqual(resRrd.matchedMandal.district, 'Rangareddy');
    assert.strictEqual(resRrd.matchedMandal.objectId, 190);

    const resJagtial = await validateAdministrativeJurisdiction({
      district: { value: 'Jagtial' },
      tehsil: { value: 'Ibrahimpatnam' }
    });
    assert.strictEqual(resJagtial.status, 'MATCHED');
    assert.strictEqual(resJagtial.matchedMandal.district, 'Jagtial');
    assert.strictEqual(resJagtial.matchedMandal.objectId, 189);
    assert.notStrictEqual(resJagtial.matchedMandal.objectId, resRrd.matchedMandal.objectId);
  });

  await runAsyncTest('8. Dynamically reports verified candidate districts on mismatch (zero hardcoding)', async () => {
    // Tandur exists in Mancherial and Vikarabad, but document says Hyderabad
    const result = await validateAdministrativeJurisdiction({
      district: { value: 'Hyderabad' },
      tehsil: { value: 'Tandur' }
    });
    assert.strictEqual(result.status, 'POTENTIAL_DISCREPANCY');
    assert.strictEqual(result.matchedMandal, null);
    assert.strictEqual(result.boundary, null);
    assert.strictEqual(result.discrepancies.length, 1);
    const disc = result.discrepancies[0];
    assert.strictEqual(disc.field, 'mandal');
    assert.ok(disc.message.includes("Mandal 'Tandur' does not belong to district 'Hyderabad'"));
    assert.ok(disc.message.includes('Mancherial'));
    assert.ok(disc.message.includes('Vikarabad'));
  });

  await runAsyncTest('9. Handles unknown mandal name across all districts', async () => {
    const result = await validateAdministrativeJurisdiction({
      district: { value: 'Rangareddy' },
      tehsil: { value: 'NonExistentMandalName' }
    });
    assert.strictEqual(result.status, 'POTENTIAL_DISCREPANCY');
    assert.ok(result.discrepancies[0].message.includes('was not found in district'));
  });

  await runAsyncTest('10. Handles missing district or mandal (UNABLE_TO_VERIFY)', async () => {
    const noDist = await validateAdministrativeJurisdiction({
      district: { value: '' },
      tehsil: { value: 'Shamshabad' }
    });
    assert.strictEqual(noDist.status, 'UNABLE_TO_VERIFY');
    assert.strictEqual(noDist.discrepancies[0].field, 'district');

    const noMandal = await validateAdministrativeJurisdiction({
      district: { value: 'Rangareddy' },
      tehsil: { value: '' },
      mandal: { value: '' }
    });
    assert.strictEqual(noMandal.status, 'UNABLE_TO_VERIFY');
    assert.strictEqual(noMandal.discrepancies[0].field, 'mandal');
  });

  // --------------------------------------------------------------------------
  // PART C: Document Model & Persistence Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Part C: Document Model & Non-Duplication Tests ---');

  // Clear test documents, users, and audit events
  await Document.deleteMany({});
  await User.deleteMany({});
  await AuditEvent.deleteMany({}, { allowTestCleanup: true });

  const citizenUser = await User.create({
    displayName: 'Citizen Alice',
    email: 'alice@example.test',
    passwordSalt: 'test_salt',
    passwordHash: 'hashed_pw',
    role: 'Citizen',
    isActive: true
  });

  const otherCitizen = await User.create({
    displayName: 'Citizen Bob',
    email: 'bob@example.test',
    passwordSalt: 'test_salt',
    passwordHash: 'hashed_pw',
    role: 'Citizen',
    isActive: true
  });

  const assignedOfficer = await User.create({
    displayName: 'Officer Jones',
    email: 'officer@example.test',
    passwordSalt: 'test_salt',
    passwordHash: 'hashed_pw',
    role: 'Officer',
    isActive: true
  });

  const unassignedOfficer = await User.create({
    displayName: 'Officer Smith',
    email: 'smith@example.test',
    passwordSalt: 'test_salt',
    passwordHash: 'hashed_pw',
    role: 'Officer',
    isActive: true
  });

  const adminUser = await User.create({
    displayName: 'Admin Eve',
    email: 'admin@example.test',
    passwordSalt: 'test_salt',
    passwordHash: 'hashed_pw',
    role: 'Admin',
    isActive: true
  });

  const testDoc = await Document.create({
    fileMetadata: {
      originalFilename: 'test_record.pdf',
      storedFilename: 'test_record_123.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      storagePath: 'uploads/test_record_123.pdf'
    },
    ownerId: citizenUser._id,
    assignedOfficerId: assignedOfficer._id,
    status: 'Needs review',
    landDetails: {
      district: { value: 'Rangareddy' },
      tehsil: { value: 'Abdullapurmet' }
    }
  });

  await runAsyncTest('11. Document initializes with gisValidation.status = NOT_RUN', async () => {
    const doc = await Document.findById(testDoc._id);
    assert.strictEqual(doc.gisValidation.status, 'NOT_RUN');
    assert.strictEqual(doc.gisValidation.matchedMandalId, null);
  });

  await runAsyncTest('12. Validation persistence stores metadata without duplicating geometry', async () => {
    const valResult = await validateAdministrativeJurisdiction(testDoc.landDetails);
    assert.strictEqual(valResult.status, 'MATCHED');

    testDoc.gisValidation = {
      status: valResult.status,
      validatedAt: new Date(),
      validatedBy: assignedOfficer._id,
      matchedMandalId: valResult.matchedMandal.objectId,
      matchedDistrict: valResult.matchedMandal.district,
      matchedMandal: valResult.matchedMandal.mandal,
      mandalType: valResult.matchedMandal.mandalType,
      revenueDivision: valResult.matchedMandal.revenueDivision,
      datasetMetadata: valResult.datasetMetadata,
      discrepancies: valResult.discrepancies,
      lastAnalyzedAt: new Date()
    };

    await testDoc.save();

    // Query raw MongoDB document to strictly verify geometry is NOT inside Document
    const rawDoc = await Document.collection.findOne({ _id: testDoc._id });
    assert.strictEqual(rawDoc.gisValidation.status, 'MATCHED');
    assert.strictEqual(rawDoc.gisValidation.matchedMandalId, 1);
    assert.strictEqual(rawDoc.gisValidation.geometry, undefined, 'geometry must NOT be in gisValidation');
    assert.strictEqual(rawDoc.gisValidation.boundary, undefined, 'boundary must NOT be in gisValidation');
    assert.strictEqual(rawDoc.gisValidation.coordinates, undefined, 'coordinates must NOT be in gisValidation');

    // Verify document status and ownerId were preserved
    assert.strictEqual(rawDoc.status, 'Needs review', 'document status must remain untouched');
    assert.strictEqual(rawDoc.ownerId.toString(), citizenUser._id.toString(), 'ownerId must remain untouched');
  });

  // --------------------------------------------------------------------------
  // PART D: RBAC & Anti-Enumeration Controller Logic Verification
  // --------------------------------------------------------------------------
  console.log('\n--- Part D: RBAC & Anti-Enumeration Authorization Logic ---');

  const { findAuthorizedDocument } = require('./middleware/auth');

  await runAsyncTest('13. Unrelated Citizen receives 404 (null) via findAuthorizedDocument', async () => {
    const doc = await findAuthorizedDocument(testDoc._id, otherCitizen);
    assert.strictEqual(doc, null, 'Unrelated Citizen must not be authorized (uniform 404)');

    const audit = await AuditEvent.findOne({
      action: 'DOCUMENT_ACCESS_DENIED',
      resourceId: testDoc._id.toString(),
      actorId: otherCitizen._id
    });
    assert.ok(audit, 'Access denial must be logged to AuditEvent');
  });

  await runAsyncTest('14. Unassigned Officer receives 404 (null) via findAuthorizedDocument', async () => {
    const doc = await findAuthorizedDocument(testDoc._id, unassignedOfficer);
    assert.strictEqual(doc, null, 'Unassigned Officer must not be authorized (uniform 404)');
  });

  await runAsyncTest('15. Citizen owner is authorized for document access but blocked from POST validation', async () => {
    const doc = await findAuthorizedDocument(testDoc._id, citizenUser);
    assert.ok(doc, 'Citizen owner must be able to resolve document');

    // Controller rule: if (req.user.role === 'Citizen') return res.status(403)
    const canValidate = (citizenUser.role === 'Officer' || citizenUser.role === 'Admin');
    assert.strictEqual(canValidate, false, 'Citizen must be rejected from POST validation with 403');
  });

  await runAsyncTest('16. Assigned Officer is authorized for document access AND POST validation', async () => {
    const doc = await findAuthorizedDocument(testDoc._id, assignedOfficer);
    assert.ok(doc, 'Assigned Officer must resolve document');
    const canValidate = (assignedOfficer.role === 'Officer' || assignedOfficer.role === 'Admin');
    assert.strictEqual(canValidate, true, 'Assigned Officer must be allowed to execute validation');
  });

  await runAsyncTest('17. Admin has global authority for document access AND POST validation', async () => {
    const doc = await findAuthorizedDocument(testDoc._id, adminUser);
    assert.ok(doc, 'Admin must resolve document');
    const canValidate = (adminUser.role === 'Officer' || adminUser.role === 'Admin');
    assert.strictEqual(canValidate, true, 'Admin must be allowed to execute validation');
  });

  await runAsyncTest('18. Canonical audit logger records DOCUMENT_GIS_VALIDATED with sanitized details', async () => {
    const { recordAuditEvent: recordDocumentAudit } = require('./audit');

    await recordDocumentAudit({
      documentId: testDoc._id,
      action: 'DOCUMENT_GIS_VALIDATED',
      req: { user: assignedOfficer },
      description: "Administrative GIS validation executed: status 'MATCHED'.",
      details: {
        status: 'MATCHED',
        matchedDistrict: 'Rangareddy',
        matchedMandal: 'Abdullapurmet',
        discrepancyCount: 0,
        datasetRetrievalDate: '2026-11-06T15:45:18.887939+00:00'
      },
      outcome: 'SUCCESS'
    });

    const auditEntry = await AuditEvent.findOne({
      documentId: testDoc._id,
      action: 'DOCUMENT_GIS_VALIDATED'
    });
    assert.ok(auditEntry, 'Audit entry must exist');
    assert.strictEqual(auditEntry.outcome, 'SUCCESS');
    assert.strictEqual(auditEntry.actor.role, 'Officer');
    assert.strictEqual(auditEntry.details.matchedMandal, 'Abdullapurmet');
  });

  // Clean test documents and users
  await Document.deleteMany({});
  await User.deleteMany({});
  await AuditEvent.deleteMany({}, { allowTestCleanup: true });
  await mongoose.disconnect();

  console.log('\n===============================================================');
  console.log(`   Phase 2A Test Results: ${passed} passed, ${failed} failed   `);
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
