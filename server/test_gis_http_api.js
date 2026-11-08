/**
 * DigiBhoomi Phase 2A GIS HTTP API Integration Test Suite
 * ========================================================
 *
 * Verifies real HTTP request/response cycles against the Express API server
 * on port 5001 and MongoDB test database:
 *
 *  1. Unauthenticated GET returns 401.
 *  2. Unauthenticated POST returns 401.
 *  3. Invalid document ID returns 400.
 *  4. Nonexistent document returns 404.
 *  5. Unrelated Citizen receives 404 (Anti-Enumeration).
 *  6. Unassigned Officer receives 404 (Anti-Enumeration).
 *  7. Citizen owner GET returns 200 (Initial NOT_RUN).
 *  8. Citizen owner POST returns 403 (Validation forbidden).
 *  9. Assigned Officer GET and POST return 200.
 * 10. Admin GET and POST return 200.
 * 11. Successful validation persists the correct metadata and dataset fingerprint.
 * 12. MATCHED, POTENTIAL_DISCREPANCY, and UNABLE_TO_VERIFY states persist correctly.
 * 13. Boundary geometry is returned separately and never stored in Document.
 * 14. Document status and ownership remain unchanged.
 * 15. Audit events are recorded using canonical audit service.
 *
 * Usage:
 *   node server/test_gis_http_api.js
 */

const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');
const { createTestIdentity, cleanupTestIdentities, makeAuthenticatedFetch } = require('./test_helpers/auth');

const Document = require('./models/Document');
const AuditEvent = require('./models/AuditEvent');
const MandalBoundary = require('./models/MandalBoundary');
const { seedMandalBoundaries } = require('./scripts/seed_mandal_boundaries');
const { MANDATORY_DISCLAIMER } = require('./services/gisService');

const createdDocIds = [];
const testIdentities = [];
let spawnedServer = null;

/**
 * Ensures test server is reachable on port 5001. Spawns one if not running.
 */
async function ensureTestServerRunning() {
  const healthUrl = `${TEST_API_BASE_URL.replace('/api', '')}/api/health`;

  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      return null; // Server already running
    }
  } catch {
    // Server not running; spawn it
  }

  console.log('[Test Harness] Spawning local test server on port 5001...');
  const child = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname),
    env: {
      ...process.env,
      PORT: '5001',
      NODE_ENV: 'test',
      MONGODB_URI: TEST_MONGODB_URI,
      UPLOAD_DIR: 'uploads_rbac_test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});

  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        console.log('[Test Harness] Test server ready on port 5001.');
        return child;
      }
    } catch {}
  }

  child.kill();
  throw new Error('Timed out waiting for test server on port 5001 to respond.');
}

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
    await AuditEvent.deleteMany({ documentId: { $in: createdDocIds } }, { allowTestCleanup: true });
  }
  await cleanupTestIdentities(testIdentities);

  if (spawnedServer) {
    console.log('[Test Harness] Shutting down spawned test server...');
    spawnedServer.kill();
  }
}

async function runGisHttpApiTests() {
  console.log('===============================================================');
  console.log('   DigiBhoomi Phase 2A: GIS HTTP API Integration Test Suite    ');
  console.log('===============================================================\n');
  console.log(`Target API URL: ${TEST_API_BASE_URL}`);
  console.log(`Test Database : ${TEST_MONGODB_URI}\n`);

  spawnedServer = await ensureTestServerRunning();

  await mongoose.connect(TEST_MONGODB_URI);

  // Ensure MandalBoundary collection has 621 features seeded
  const mbCount = await MandalBoundary.countDocuments();
  if (mbCount !== 621) {
    console.log('[Setup] Seeding test database with 621 Mandal boundaries...');
    await seedMandalBoundaries();
  }

  // Create real test users
  const citizenAlice = await createTestIdentity('Citizen');
  testIdentities.push(citizenAlice);
  const aliceFetch = makeAuthenticatedFetch(citizenAlice.cookie);

  const citizenBob = await createTestIdentity('Citizen');
  testIdentities.push(citizenBob);
  const bobFetch = makeAuthenticatedFetch(citizenBob.cookie);

  const officerCharlie = await createTestIdentity('Officer');
  testIdentities.push(officerCharlie);
  const charlieFetch = makeAuthenticatedFetch(officerCharlie.cookie);

  const officerUnassigned = await createTestIdentity('Officer');
  testIdentities.push(officerUnassigned);
  const unassignedFetch = makeAuthenticatedFetch(officerUnassigned.cookie);

  const adminUser = await createTestIdentity('Admin');
  testIdentities.push(adminUser);
  const adminFetch = makeAuthenticatedFetch(adminUser.cookie);

  // Create test documents owned by Alice with Charlie assigned
  const docMatched = await Document.create({
    ownerId: citizenAlice.user._id,
    assignedOfficerId: officerCharlie.user._id,
    fileMetadata: {
      originalFilename: 'Doc_Matched.pdf',
      storedFilename: 'test_matched_01.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256Hash: 'hash-test-gis-matched-01',
      storagePath: 'uploads_rbac_test/test_matched_01.pdf'
    },
    status: 'Needs review',
    landDetails: {
      district: { value: 'Rangareddy' },
      tehsil: { value: 'Abdullapurmet' }
    }
  });
  createdDocIds.push(docMatched._id);

  const docDiscrepancy = await Document.create({
    ownerId: citizenAlice.user._id,
    assignedOfficerId: officerCharlie.user._id,
    fileMetadata: {
      originalFilename: 'Doc_Discrepancy.pdf',
      storedFilename: 'test_discrepancy_02.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256Hash: 'hash-test-gis-disc-02',
      storagePath: 'uploads_rbac_test/test_discrepancy_02.pdf'
    },
    status: 'Needs review',
    landDetails: {
      district: { value: 'Hyderabad' },
      tehsil: { value: 'Tandur' }
    }
  });
  createdDocIds.push(docDiscrepancy._id);

  const docUnable = await Document.create({
    ownerId: citizenAlice.user._id,
    assignedOfficerId: officerCharlie.user._id,
    fileMetadata: {
      originalFilename: 'Doc_Unable.pdf',
      storedFilename: 'test_unable_03.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      sha256Hash: 'hash-test-gis-unable-03',
      storagePath: 'uploads_rbac_test/test_unable_03.pdf'
    },
    status: 'Needs review',
    landDetails: {
      district: { value: 'Rangareddy' },
      tehsil: { value: '' },
      mandal: { value: '' }
    }
  });
  createdDocIds.push(docUnable._id);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
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

  try {
    // 1. Unauthenticated GET returns 401
    await test('1. Unauthenticated GET /api/documents/:id/gis returns 401', async () => {
      const res = await fetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Authentication required.');
    });

    // 2. Unauthenticated POST returns 401
    await test('2. Unauthenticated POST /api/documents/:id/gis/validate returns 401', async () => {
      const res = await fetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error, 'Authentication required.');
    });

    // 3. Invalid document ID returns 400
    await test('3. Invalid document ID returns 400 on GET and POST', async () => {
      const resGet = await adminFetch(`${TEST_API_BASE_URL}/documents/not-a-valid-object-id/gis`);
      assert.strictEqual(resGet.status, 400);

      const resPost = await adminFetch(`${TEST_API_BASE_URL}/documents/not-a-valid-object-id/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 400);
    });

    // 4. Nonexistent document returns 404
    await test('4. Nonexistent document returns 404 on GET and POST', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      const resGet = await adminFetch(`${TEST_API_BASE_URL}/documents/${fakeId}/gis`);
      assert.strictEqual(resGet.status, 404);

      const resPost = await adminFetch(`${TEST_API_BASE_URL}/documents/${fakeId}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 404);
    });

    // 5. Unrelated Citizen receives 404 (Anti-Enumeration)
    await test('5. Unrelated Citizen receives 404 on GET and POST (anti-enumeration)', async () => {
      const resGet = await bobFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(resGet.status, 404, 'Unrelated Citizen GET must return 404');

      const resPost = await bobFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 404, 'Unrelated Citizen POST must return 404');
    });

    // 6. Unassigned Officer receives 404 (Anti-Enumeration)
    await test('6. Unassigned Officer receives 404 on GET and POST (anti-enumeration)', async () => {
      const resGet = await unassignedFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(resGet.status, 404, 'Unassigned Officer GET must return 404');

      const resPost = await unassignedFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 404, 'Unassigned Officer POST must return 404');
    });

    // 7. Citizen owner GET returns 200 (Initial NOT_RUN state)
    await test('7. Citizen owner GET returns 200 with status NOT_RUN and disclaimer', async () => {
      const res = await aliceFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.gisValidation.status, 'NOT_RUN');
      assert.strictEqual(data.gisValidation.boundary, null);
      assert.strictEqual(data.gisValidation.disclaimer, MANDATORY_DISCLAIMER);
      assert.strictEqual(data.gisValidation.datasetMetadata.fingerprint, '548140196bd0ad11aad4a48923882861b25f97961afe516cdb90fffdbe9ea2fe');
    });

    // 8. Citizen owner POST returns 403 (Validation forbidden)
    await test('8. Citizen owner POST returns 403 (Forbidden for Citizens)', async () => {
      const res = await aliceFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('Citizens are not permitted to execute official administrative GIS validation'));
    });

    // 9. Assigned Officer GET and POST return 200
    await test('9. Assigned Officer GET and POST return 200 with MATCHED outcome', async () => {
      const resGet = await charlieFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(resGet.status, 200);

      const resPost = await charlieFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 200);
      const data = await resPost.json();
      assert.strictEqual(data.gisValidation.status, 'MATCHED');
      assert.strictEqual(data.gisValidation.matchedDistrict, 'Rangareddy');
      assert.strictEqual(data.gisValidation.matchedMandal, 'Abdullapurmet');
      assert.strictEqual(data.gisValidation.matchedMandalId, 1);
      assert.strictEqual(data.gisValidation.discrepancies.length, 0);
      assert.strictEqual(data.gisValidation.boundary.type, 'Feature');
      assert.strictEqual(data.gisValidation.boundary.geometry.type, 'Polygon');
      assert.strictEqual(data.gisValidation.disclaimer, MANDATORY_DISCLAIMER);
    });

    // 10. Admin GET and POST return 200
    await test('10. Admin GET and POST return 200 with global authority', async () => {
      const resGet = await adminFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis`);
      assert.strictEqual(resGet.status, 200);

      const resPost = await adminFetch(`${TEST_API_BASE_URL}/documents/${docMatched._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resPost.status, 200);
      const data = await resPost.json();
      assert.strictEqual(data.gisValidation.status, 'MATCHED');
    });

    // 11. Successful validation persists the correct metadata & GeoJSON fingerprint
    await test('11. Successful validation persists metadata and GeoJSON dataset fingerprint in MongoDB', async () => {
      const rawDoc = await Document.collection.findOne({ _id: docMatched._id });
      assert.strictEqual(rawDoc.gisValidation.status, 'MATCHED');
      assert.strictEqual(rawDoc.gisValidation.matchedDistrict, 'Rangareddy');
      assert.strictEqual(rawDoc.gisValidation.matchedMandal, 'Abdullapurmet');
      assert.strictEqual(rawDoc.gisValidation.matchedMandalId, 1);
      assert.strictEqual(rawDoc.gisValidation.mandalType, 'Rural Mandal');
      assert.strictEqual(rawDoc.gisValidation.revenueDivision, 'Ibrahimpatnam');
      assert.strictEqual(
        rawDoc.gisValidation.datasetMetadata.fingerprint,
        '548140196bd0ad11aad4a48923882861b25f97961afe516cdb90fffdbe9ea2fe'
      );
    });

    // 12. MATCHED, POTENTIAL_DISCREPANCY, and UNABLE_TO_VERIFY states persist correctly
    await test('12. POTENTIAL_DISCREPANCY and UNABLE_TO_VERIFY states persist correctly via POST', async () => {
      // Validate docDiscrepancy (Hyderabad + Tandur -> should discover Mancherial & Vikarabad)
      const resDisc = await charlieFetch(`${TEST_API_BASE_URL}/documents/${docDiscrepancy._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resDisc.status, 200);
      const dataDisc = await resDisc.json();
      assert.strictEqual(dataDisc.gisValidation.status, 'POTENTIAL_DISCREPANCY');
      assert.strictEqual(dataDisc.gisValidation.boundary, null);
      assert.strictEqual(dataDisc.gisValidation.discrepancies.length, 1);
      assert.ok(dataDisc.gisValidation.discrepancies[0].message.includes('Mancherial'));
      assert.ok(dataDisc.gisValidation.discrepancies[0].message.includes('Vikarabad'));

      const rawDisc = await Document.collection.findOne({ _id: docDiscrepancy._id });
      assert.strictEqual(rawDisc.gisValidation.status, 'POTENTIAL_DISCREPANCY');

      // Validate docUnable (missing mandal -> UNABLE_TO_VERIFY)
      const resUnable = await charlieFetch(`${TEST_API_BASE_URL}/documents/${docUnable._id}/gis/validate`, {
        method: 'POST'
      });
      assert.strictEqual(resUnable.status, 200);
      const dataUnable = await resUnable.json();
      assert.strictEqual(dataUnable.gisValidation.status, 'UNABLE_TO_VERIFY');
      assert.strictEqual(dataUnable.gisValidation.boundary, null);

      const rawUnable = await Document.collection.findOne({ _id: docUnable._id });
      assert.strictEqual(rawUnable.gisValidation.status, 'UNABLE_TO_VERIFY');
    });

    // 13. Boundary geometry is returned separately and never stored in Document
    await test('13. Boundary geometry is returned in HTTP response and NEVER stored in Document', async () => {
      for (const id of [docMatched._id, docDiscrepancy._id, docUnable._id]) {
        const raw = await Document.collection.findOne({ _id: id });
        assert.strictEqual(raw.gisValidation.geometry, undefined, 'geometry must be undefined in raw Document');
        assert.strictEqual(raw.gisValidation.boundary, undefined, 'boundary must be undefined in raw Document');
        assert.strictEqual(raw.gisValidation.coordinates, undefined, 'coordinates must be undefined in raw Document');
      }
    });

    // 14. Document status and ownership remain unchanged
    await test('14. Document status, ownerId, and assignedOfficerId remain completely unchanged', async () => {
      const rawMatched = await Document.collection.findOne({ _id: docMatched._id });
      assert.strictEqual(rawMatched.status, 'Needs review', 'document status must not be altered');
      assert.strictEqual(rawMatched.ownerId.toString(), citizenAlice.user._id.toString(), 'ownerId must not be altered');
      assert.strictEqual(rawMatched.assignedOfficerId.toString(), officerCharlie.user._id.toString());
    });

    // 15. Audit events are recorded using canonical audit service
    await test('15. Canonical audit log records DOCUMENT_GIS_VALIDATED with verified details', async () => {
      const auditEntries = await AuditEvent.find({
        documentId: docMatched._id,
        action: 'DOCUMENT_GIS_VALIDATED'
      }).sort({ timestamp: 1 });

      assert.strictEqual(auditEntries.length, 2, 'Must record audit events for both Officer and Admin validations');

      // First validation was by Assigned Officer Charlie (Test 9)
      const officerAudit = auditEntries[0];
      assert.strictEqual(officerAudit.outcome, 'SUCCESS');
      assert.strictEqual(officerAudit.actor.role, 'Officer');
      assert.strictEqual(officerAudit.details.matchedMandal, 'Abdullapurmet');
      assert.strictEqual(officerAudit.details.matchedDistrict, 'Rangareddy');
      assert.strictEqual(
        officerAudit.details.datasetFingerprint,
        '548140196bd0ad11aad4a48923882861b25f97961afe516cdb90fffdbe9ea2fe'
      );

      // Second validation was by Admin User (Test 10)
      const adminAudit = auditEntries[1];
      assert.strictEqual(adminAudit.outcome, 'SUCCESS');
      assert.strictEqual(adminAudit.actor.role, 'Admin');
      assert.strictEqual(adminAudit.details.matchedMandal, 'Abdullapurmet');
      assert.strictEqual(adminAudit.details.matchedDistrict, 'Rangareddy');
    });

  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  console.log('\n===============================================================');
  console.log(`   Phase 2A HTTP API Test Results: ${passed} passed, ${failed} failed   `);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runGisHttpApiTests().catch(err => {
    console.error('[FATAL HTTP TEST ERROR]', err);
    if (spawnedServer) spawnedServer.kill();
    process.exit(1);
  });
}

module.exports = { runGisHttpApiTests };
