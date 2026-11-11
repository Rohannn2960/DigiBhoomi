const mongoose = require('mongoose');
const assert = require('assert');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');
const { createTestIdentity, cleanupTestIdentities, makeAuthenticatedFetch } = require('./test_helpers/auth');

const Document = require('./models/Document');
const AuditEvent = require('./models/AuditEvent');

const createdDocIds = [];
const testIdentities = [];

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
    await AuditEvent.deleteMany({ documentId: { $in: createdDocIds } });
  }
  await cleanupTestIdentities(testIdentities);
}

async function runDocumentComparisonHttpTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Document Comparison HTTP & RBAC Tests');
  console.log('====================================================\n');

  await mongoose.connect(TEST_MONGODB_URI);
  const compareBaseUrl = `${TEST_API_BASE_URL}/documents/compare`;

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

  const adminUser = await createTestIdentity('Admin');
  testIdentities.push(adminUser);
  const adminFetch = makeAuthenticatedFetch(adminUser.cookie);

  let passed = 0;
  let failed = 0;

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

  try {
    // 1. Create two documents owned by Alice
    const docAlice1 = new Document({
      ownerId: citizenAlice.user._id,
      assignedOfficerId: officerCharlie.user._id,
      status: 'Needs review',
      fileMetadata: {
        originalFilename: 'alice_plot_1.pdf',
        storedFilename: 'alice_plot_1.pdf',
        storagePath: 'alice_plot_1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256Hash: '1'.repeat(64)
      },
      landDetails: {
        ownerName: { value: 'Alice Smith', confidence: 0.95 },
        surveyNumber: { value: '101/A', confidence: 0.92 },
        khataNumber: { value: 'KH-10', confidence: 0.90 },
        landArea: { value: '1.5', unit: 'Acre', confidence: 0.88 },
        village: { value: 'Shamshabad Village', confidence: 0.93 },
        tehsil: { value: 'Shamshabad', confidence: 0.94 },
        district: { value: 'Rangareddy', confidence: 0.97 }
      },
      accessControl: { uploadedBy: citizenAlice.user._id.toString() }
    });
    await docAlice1.save();
    createdDocIds.push(docAlice1._id);

    const docAlice2 = new Document({
      ownerId: citizenAlice.user._id,
      assignedOfficerId: officerCharlie.user._id,
      status: 'Verified',
      fileMetadata: {
        originalFilename: 'alice_plot_2.pdf',
        storedFilename: 'alice_plot_2.pdf',
        storagePath: 'alice_plot_2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        sha256Hash: '2'.repeat(64)
      },
      landDetails: {
        ownerName: { value: 'Alice Smith', confidence: 0.96 },
        surveyNumber: { value: '102/B', confidence: 0.91 }, // Differs
        khataNumber: { value: 'KH-10', confidence: 0.90 },  // Identical
        landArea: { value: '2.0', unit: 'Acre', confidence: 0.85 }, // Differs
        village: { value: 'Shamshabad Village', confidence: 0.93 }, // Identical
        tehsil: { value: 'Shamshabad', confidence: 0.94 }, // Identical
        district: { value: 'Rangareddy', confidence: 0.97 }  // Identical
      },
      accessControl: { uploadedBy: citizenAlice.user._id.toString() }
    });
    await docAlice2.save();
    createdDocIds.push(docAlice2._id);

    // 2. Create a document owned by Bob
    const docBob = new Document({
      ownerId: citizenBob.user._id,
      status: 'Uploaded',
      fileMetadata: {
        originalFilename: 'bob_farmland.pdf',
        storedFilename: 'bob_farmland.pdf',
        storagePath: 'bob_farmland.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: '3'.repeat(64)
      },
      landDetails: {
        ownerName: { value: 'Bob Jones', confidence: 0.89 },
        surveyNumber: { value: '305/C', confidence: 0.87 },
        village: { value: 'Kothur', confidence: 0.91 },
        district: { value: 'Rangareddy', confidence: 0.96 }
      },
      accessControl: { uploadedBy: citizenBob.user._id.toString() }
    });
    await docBob.save();
    createdDocIds.push(docBob._id);

    // TEST 1: Alice compares two of her own documents
    await runAsyncTest('1. Citizen Alice compares two of her own documents (HTTP 200)', async () => {
      const res = await aliceFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docAlice2._id}`);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert(body.documentA, 'Document A summary must exist');
      assert(body.documentB, 'Document B summary must exist');
      assert.strictEqual(body.documentA.id, docAlice1._id.toString());
      assert.strictEqual(body.documentB.id, docAlice2._id.toString());

      // Check surveyNumber differs
      const surveyDiff = body.allAttributes.find(a => a.key === 'surveyNumber');
      assert.strictEqual(surveyDiff.status, 'DIFFERENT');
      assert.strictEqual(surveyDiff.statusLabel, 'Different / Discrepancy');

      // Check khataNumber identical
      const khataDiff = body.allAttributes.find(a => a.key === 'khataNumber');
      assert.strictEqual(khataDiff.status, 'IDENTICAL');

      // Check field-level confidence retained
      assert.strictEqual(surveyDiff.docAConfidence, 0.92);
      assert.strictEqual(surveyDiff.docBConfidence, 0.91);
    });

    // TEST 2: Alice attempts to compare her document with Bob's document (RBAC violation)
    await runAsyncTest('2. Citizen Alice cannot compare with Bob document (HTTP 404 anti-enumeration)', async () => {
      const res = await aliceFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docBob._id}`);
      assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    });

    // TEST 3: Officer Charlie compares assigned documents
    await runAsyncTest('3. Assigned Officer Charlie compares assigned documents (HTTP 200)', async () => {
      const res = await charlieFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docAlice2._id}`);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    });

    // TEST 4: Officer Charlie attempts to compare unassigned document (Bob's)
    await runAsyncTest('4. Officer Charlie cannot compare unassigned document (HTTP 404)', async () => {
      const res = await charlieFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docBob._id}`);
      assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    });

    // TEST 5: Admin compares across any two documents (Alice's and Bob's)
    await runAsyncTest('5. Admin compares across any two documents (Alice and Bob) (HTTP 200)', async () => {
      const res = await adminFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docBob._id}`);
      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
      const body = await res.json();
      assert.strictEqual(body.documentA.id, docAlice1._id.toString());
      assert.strictEqual(body.documentB.id, docBob._id.toString());
      assert(body.summary.landAttributes.differentCount > 0 && body.summary.landDiscrepanciesCount > 0, 'Must identify differences between Alice and Bob documents');
      assert.strictEqual(body.documentA.assignedOfficerId, docAlice1.assignedOfficerId.toString());
      assert.strictEqual(body.documentB.assignedOfficerId, null);
      const officerMeta = body.metadataAttributes.find((m) => m.key === 'assignedOfficer');
      assert(officerMeta, 'Must include assignedOfficer in metadataAttributes');
      assert.strictEqual(officerMeta.docAValue, docAlice1.assignedOfficerId.toString());
      assert.strictEqual(officerMeta.docBValue, 'Unassigned');
      assert.strictEqual(officerMeta.status, 'DIFFERENT');
    });

    // TEST 6: Rejection of identical document IDs
    await runAsyncTest('6. Compares same document ID returns HTTP 400', async () => {
      const res = await adminFetch(`${compareBaseUrl}?doc1=${docAlice1._id}&doc2=${docAlice1._id}`);
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
      const body = await res.json();
      assert(body.error.includes('Two distinct documents are required'));
    });

    // TEST 7: Missing parameters
    await runAsyncTest('7. Missing parameters returns HTTP 400', async () => {
      const res = await adminFetch(`${compareBaseUrl}?doc1=${docAlice1._id}`);
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    });

    // TEST 8: Invalid ObjectId format
    await runAsyncTest('8. Invalid ObjectId returns HTTP 400', async () => {
      const res = await adminFetch(`${compareBaseUrl}?doc1=not-an-id&doc2=${docAlice1._id}`);
      assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    });

    // TEST 9: Audit Trail Logging
    await runAsyncTest('9. Comparison operation logs DOCUMENTS_COMPARED audit event', async () => {
      const auditEvt = await AuditEvent.findOne({
        documentId: docAlice1._id,
        action: 'DOCUMENTS_COMPARED'
      }).sort({ timestamp: -1 });

      assert(auditEvt, 'Audit event DOCUMENTS_COMPARED must be recorded');
      assert.strictEqual(auditEvt.outcome, 'SUCCESS');
    });

  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDocumentComparisonHttpTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
