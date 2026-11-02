const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');
const { createTestIdentity, cleanupTestIdentities, makeAuthenticatedFetch } = require('./test_helpers/auth');

const Document = require('./models/Document');
const SemanticEmbedding = require('./models/SemanticEmbedding');
const { indexDocument } = require('./services/semanticSearchService');

const createdDocIds = [];
const testIdentities = [];

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
    await SemanticEmbedding.deleteMany({ documentId: { $in: createdDocIds } });
  }
  await cleanupTestIdentities(testIdentities);
}

async function runSearchRbacApiTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Search Route RBAC Verification');
  console.log('====================================================\n');

  await mongoose.connect(TEST_MONGODB_URI);
  const searchBaseUrl = `${TEST_API_BASE_URL}/search`;

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

  try {
    // 1. Create Alice's document and index it
    const docAlice = new Document({
      ownerId: citizenAlice.user._id,
      assignedOfficerId: officerCharlie.user._id,
      fileMetadata: {
        originalFilename: 'Alice_Farm_Deed.pdf',
        storedFilename: 'alice_farm.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256Hash: 'hash-alice-deed-1111',
        storagePath: path.resolve(__dirname, 'uploads', 'alice_farm.pdf')
      },
      status: 'Verified',
      landDetails: {
        ownerName: { value: 'Alice Green' },
        khasraNumber: { value: '555/A' },
        village: { value: 'Shamshabad' },
        district: { value: 'Rangareddy' },
        landClassification: { value: 'Agricultural' }
      }
    });
    await docAlice.save();
    createdDocIds.push(docAlice._id);
    await indexDocument(docAlice._id);

    // 2. Create Bob's document and index it
    const docBob = new Document({
      ownerId: citizenBob.user._id,
      fileMetadata: {
        originalFilename: 'Bob_Plot_Deed.pdf',
        storedFilename: 'bob_plot.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256Hash: 'hash-bob-deed-2222',
        storagePath: path.resolve(__dirname, 'uploads', 'bob_plot.pdf')
      },
      status: 'Verified',
      landDetails: {
        ownerName: { value: 'Bob Builder' },
        khasraNumber: { value: '777/B' },
        village: { value: 'Shamshabad' },
        district: { value: 'Rangareddy' },
        landClassification: { value: 'Agricultural' }
      }
    });
    await docBob.save();
    createdDocIds.push(docBob._id);
    await indexDocument(docBob._id);

    console.log('Test 1: Unauthenticated requests cannot access protected search endpoints');
    const unauthRes = await fetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated search must return 401');
    console.log('  ✓ Pass: Unauthenticated search blocked with HTTP 401.\n');

    console.log('Test 2: Client-supplied spoofed identity headers cannot bypass authentication');
    const spoofedRes = await fetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': adminUser.user._id.toString(),
        'x-user-role': 'Admin'
      },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(spoofedRes.status, 401, 'Spoofed identity headers must return 401');
    console.log('  ✓ Pass: Client-supplied headers cannot bypass authentication.\n');

    console.log('Test 3: Citizen Alice can search and see her own record');
    const aliceRes = await aliceFetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(aliceRes.status, 200);
    const aliceData = await aliceRes.json();
    const aliceDocIds = aliceData.results.map(r => r.documentId.toString());
    assert(aliceDocIds.includes(docAlice._id.toString()), 'Alice must see her own document');
    console.log('  ✓ Pass: Citizen Alice sees her own record.\n');

    console.log('Test 4: Citizen Alice cannot discover Citizen Bob\'s record');
    assert(!aliceDocIds.includes(docBob._id.toString()), 'Alice must NOT see Bob\'s document');
    // Ensure totalIndexed reflects only accessible records for Alice
    assert.strictEqual(aliceData.totalIndexed, 1, 'Alice totalIndexed must reflect only her accessible records (1)');
    console.log('  ✓ Pass: Citizen Alice cannot discover Bob\'s record and totalIndexed is scoped.\n');

    console.log('Test 5: Assigned Officer Charlie can search and see assigned record');
    const charlieRes = await charlieFetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(charlieRes.status, 200);
    const charlieData = await charlieRes.json();
    const charlieDocIds = charlieData.results.map(r => r.documentId.toString());
    assert(charlieDocIds.includes(docAlice._id.toString()), 'Assigned Officer must see assigned document');
    assert(!charlieDocIds.includes(docBob._id.toString()), 'Assigned Officer must NOT see unassigned document');
    console.log('  ✓ Pass: Assigned Officer sees assigned document only.\n');

    console.log('Test 6: Unassigned Officer cannot discover unassigned records');
    const unassignedRes = await unassignedFetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(unassignedRes.status, 200);
    const unassignedData = await unassignedRes.json();
    assert.strictEqual(unassignedData.results.length, 0, 'Unassigned officer must see 0 results');
    assert.strictEqual(unassignedData.totalIndexed, 0, 'Unassigned officer totalIndexed must be 0');
    console.log('  ✓ Pass: Unassigned Officer sees 0 results and totalIndexed is 0.\n');

    console.log('Test 7: Admin can search all records');
    const adminRes = await adminFetch(`${searchBaseUrl}/semantic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Shamshabad Agricultural' })
    });
    assert.strictEqual(adminRes.status, 200);
    const adminData = await adminRes.json();
    const adminDocIds = adminData.results.map(r => r.documentId.toString());
    assert(adminDocIds.includes(docAlice._id.toString()), 'Admin must see Alice\'s document');
    assert(adminDocIds.includes(docBob._id.toString()), 'Admin must see Bob\'s document');
    assert.strictEqual(adminData.totalIndexed >= 2, true, 'Admin totalIndexed includes all records');
    console.log('  ✓ Pass: Admin sees all records.\n');

    console.log('Test 8: Manual indexing and backfill enforce Admin permissions');
    // Citizen Alice attempts indexing -> 403
    const aliceIndexRes = await aliceFetch(`${searchBaseUrl}/index/${docAlice._id}`, { method: 'POST' });
    assert.strictEqual(aliceIndexRes.status, 403, 'Citizen must be denied manual indexing');

    // Officer Charlie attempts indexing -> 403
    const officerIndexRes = await charlieFetch(`${searchBaseUrl}/index/${docAlice._id}`, { method: 'POST' });
    assert.strictEqual(officerIndexRes.status, 403, 'Officer must be denied manual indexing');

    // Citizen Alice attempts backfill -> 403
    const aliceBackfillRes = await aliceFetch(`${searchBaseUrl}/backfill`, { method: 'POST' });
    assert.strictEqual(aliceBackfillRes.status, 403, 'Citizen must be denied backfill');

    // Admin attempts indexing -> 200
    const adminIndexRes = await adminFetch(`${searchBaseUrl}/index/${docAlice._id}`, { method: 'POST' });
    assert.strictEqual(adminIndexRes.status, 200, 'Admin must be permitted manual indexing');

    // Admin attempts backfill -> 200
    const adminBackfillRes = await adminFetch(`${searchBaseUrl}/backfill`, { method: 'POST' });
    assert.strictEqual(adminBackfillRes.status, 200, 'Admin must be permitted backfill');
    console.log('  ✓ Pass: Manual indexing and backfill strictly enforce Admin permissions.\n');

    console.log('Test 9: Search status endpoint requires authentication');
    const anonStatusRes = await fetch(`${searchBaseUrl}/status`);
    assert.strictEqual(anonStatusRes.status, 401, 'Anonymous status check must return 401');

    const authStatusRes = await aliceFetch(`${searchBaseUrl}/status`);
    assert.strictEqual(authStatusRes.status, 200, 'Authenticated user can check status');
    console.log('  ✓ Pass: Search status endpoint protected by authentication.\n');

    console.log('====================================================');
    console.log('All Search Route RBAC Tests Passed Successfully! ✓');
    console.log('====================================================\n');

  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

runSearchRbacApiTests().catch((err) => {
  console.error('\n❌ Search Route RBAC Test Error:', err);
  process.exit(1);
});
