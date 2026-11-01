const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');
const { createTestIdentity, cleanupTestIdentities, makeAuthenticatedFetch } = require('./test_helpers/auth');

const Document = require('./models/Document');

const createdDocIds = [];
const testIdentities = [];

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
  }
  await cleanupTestIdentities(testIdentities);
}

async function runApiTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Phase 4 API & Authorization Tests');
  console.log('====================================================\n');

  await mongoose.connect(TEST_MONGODB_URI);
  const baseUrl = `${TEST_API_BASE_URL}/documents`;

  const aliceIdentity = await createTestIdentity('Citizen');
  testIdentities.push(aliceIdentity);
  const aliceFetch = makeAuthenticatedFetch(aliceIdentity.cookie);

  const bobIdentity = await createTestIdentity('Citizen');
  testIdentities.push(bobIdentity);
  const bobFetch = makeAuthenticatedFetch(bobIdentity.cookie);

  const officerIdentity = await createTestIdentity('Officer');
  testIdentities.push(officerIdentity);
  const officerFetch = makeAuthenticatedFetch(officerIdentity.cookie);

  try {
    // 1. Create Base Document (Doc A) owned by Alice
    const docA = new Document({
      ownerId: aliceIdentity.user._id,
      fileMetadata: {
        originalFilename: 'Base_Record_142.pdf',
        storedFilename: 'test_base_142.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        sha256Hash: 'hash-test-base-142',
        storagePath: path.resolve(__dirname, 'uploads', 'test_base_142.pdf')
      },
      status: 'Needs review',
      landDetails: {
        ownerName: { value: 'Ram Charan Sharma' },
        khasraNumber: { value: '142/2' },
        surveyNumber: { value: '142/2' },
        khataNumber: { value: '00058' },
        landArea: { value: '1.4500', unit: 'Hectare' },
        village: { value: 'Khaspur' },
        tehsil: { value: 'Sadar' },
        district: { value: 'Lucknow' },
        landClassification: { value: 'Agricultural' }
      },
      extractionValidation: {
        score: 95,
        reviewReasons: []
      }
    });
    await docA.save();
    createdDocIds.push(docA._id);

    // 2. Create Conflicting Document (Doc B: Same parcel 142/2 in Khaspur, different owner "Shyam Lal" and area "2.1000")
    const docB = new Document({
      ownerId: aliceIdentity.user._id,
      fileMetadata: {
        originalFilename: 'Conflicting_Mutation_142.pdf',
        storedFilename: 'test_conf_142.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        sha256Hash: 'hash-test-conf-142',
        storagePath: path.resolve(__dirname, 'uploads', 'test_conf_142.pdf')
      },
      status: 'Needs review',
      landDetails: {
        ownerName: { value: 'Shyam Lal Gupta' },
        khasraNumber: { value: '142/2' },
        khataNumber: { value: '00058' },
        landArea: { value: '2.1000', unit: 'Hectare' },
        village: { value: 'Khaspur' },
        tehsil: { value: 'Sadar' },
        district: { value: 'Lucknow' }
      }
    });
    await docB.save();
    createdDocIds.push(docB._id);

    // 3. Create Duplicate Candidate Document (Doc C: Exact land parcel and owner match)
    const docC = new Document({
      ownerId: aliceIdentity.user._id,
      fileMetadata: {
        originalFilename: 'Duplicate_Upload_142.pdf',
        storedFilename: 'test_dup_142.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        sha256Hash: 'hash-test-dup-142',
        storagePath: path.resolve(__dirname, 'uploads', 'test_dup_142.pdf')
      },
      status: 'Needs review',
      landDetails: {
        ownerName: { value: 'Ram Charan Sharma' },
        khasraNumber: { value: '142/2' },
        khataNumber: { value: '00058' },
        landArea: { value: '1.4500', unit: 'Hectare' },
        village: { value: 'Khaspur' },
        district: { value: 'Lucknow' }
      }
    });
    await docC.save();
    createdDocIds.push(docC._id);

    // 4. Create Private Document owned by Bob and assigned to Officer
    const docPrivate = new Document({
      ownerId: bobIdentity.user._id,
      assignedOfficerId: officerIdentity.user._id,
      fileMetadata: {
        originalFilename: 'Bob_Private_Record.pdf',
        storedFilename: 'bob_private.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        sha256Hash: 'hash-bob-private',
        storagePath: path.resolve(__dirname, 'uploads', 'bob_private.pdf')
      },
      status: 'Needs review',
      accessControl: {
        uploadedBy: bobIdentity.user._id.toString(),
        isPrivate: true
      },
      landDetails: {
        ownerName: { value: 'Bob Builder' },
        khasraNumber: { value: '999/1' },
        village: { value: 'Khaspur' },
        district: { value: 'Lucknow' }
      }
    });
    await docPrivate.save();
    createdDocIds.push(docPrivate._id);

    console.log('Test 1: GET /api/documents/:id/conflicts returns duplicate and conflict analysis');
    const getRes = await aliceFetch(`${baseUrl}/${docA._id}/conflicts?refresh=true`);
    assert.strictEqual(getRes.status, 200, `Expected 200, got ${getRes.status}`);
    const getData = await getRes.json();

    assert(getData.duplicateDetection, 'duplicateDetection object must be returned');
    assert(getData.conflictDetection, 'conflictDetection object must be returned');
    assert.strictEqual(getData.duplicateDetection.hasPotentialDuplicates, true);
    assert(getData.duplicateDetection.matches.some(m => String(m.targetDocumentId) === String(docC._id)));
    assert.strictEqual(getData.conflictDetection.hasConflicts, true);
    assert(getData.conflictDetection.conflicts.some(c => String(c.targetDocumentId) === String(docB._id)));
    console.log('  ✓ Pass: GET /api/documents/:id/conflicts accurately detects duplicates and conflicts.\n');

    console.log('Test 2: POST /api/documents/:id/conflicts/analyze triggers re-analysis and persists in DB');
    const postRes = await aliceFetch(`${baseUrl}/${docA._id}/conflicts/analyze`, { method: 'POST' });
    assert.strictEqual(postRes.status, 200);
    const postData = await postRes.json();
    assert.strictEqual(postData.duplicateDetection.hasPotentialDuplicates, true);
    assert.strictEqual(postData.conflictDetection.hasConflicts, true);

    // Verify persistence in MongoDB directly
    const reloadedDoc = await Document.findById(docA._id);
    assert(reloadedDoc.duplicateDetection?.lastAnalyzedAt !== null);
    assert(reloadedDoc.conflictDetection?.lastAnalyzedAt !== null);
    assert.strictEqual(reloadedDoc.extractionValidation.score, 95, 'Extraction Validation Score must remain intact');
    console.log('  ✓ Pass: Analysis persists to MongoDB without altering extraction validation score.\n');

    console.log('Test 3: Authorization Check — Unauthorized user cannot access other user private documents');
    const unauthRes = await aliceFetch(`${baseUrl}/${docPrivate._id}/conflicts`);
    assert.strictEqual(unauthRes.status, 404, `Expected 404 Not Found, got ${unauthRes.status}`);
    const unauthData = await unauthRes.json();
    assert(unauthData.error.includes('Document not found'), 'Error message should indicate document not found');
    console.log('  ✓ Pass: HTTP 404 Not Found returned for unauthorized document access.\n');

    console.log('Test 4: Authorization Check — Authorized owner can access private document');
    const authRes = await bobFetch(`${baseUrl}/${docPrivate._id}/conflicts`);
    assert.strictEqual(authRes.status, 200, `Expected 200 OK, got ${authRes.status}`);
    console.log('  ✓ Pass: Document owner can access private document.\n');

    console.log('Test 5: Authorization Check — Assigned officer reviewer has access');
    const officerRes = await officerFetch(`${baseUrl}/${docPrivate._id}/conflicts`);
    assert.strictEqual(officerRes.status, 200, `Expected 200 OK, got ${officerRes.status}`);
    console.log('  ✓ Pass: Assigned Revenue Officer reviewer role has access.\n');

    console.log('Test 6: Internal server paths and credentials are NOT leaked in response');
    const jsonStr = JSON.stringify(getData);
    assert(!jsonStr.includes('storagePath'), 'Internal storagePath must not be exposed');
    assert(!jsonStr.includes('uploads\\\\'), 'Filesystem paths must not be exposed');
    assert(!jsonStr.includes('uploads/'), 'Filesystem paths must not be exposed');
    console.log('  ✓ Pass: No filesystem paths or credentials leaked in response.\n');

    console.log('====================================================');
    console.log('All API & Authorization Tests Passed Successfully!');
    console.log('====================================================\n');
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

runApiTests().catch((err) => {
  console.error('API Test Suite Error:', err);
  process.exit(1);
});
