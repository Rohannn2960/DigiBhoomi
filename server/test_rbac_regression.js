const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');
const { createTestIdentity, cleanupTestIdentities, makeAuthenticatedFetch } = require('./test_helpers/auth');

const Document = require('./models/Document');
const AuditEvent = require('./models/AuditEvent');
const { recordAuditEvent: recordSecurityAudit } = require('./services/audit');
const { recordAuditEvent: recordDocumentAudit } = require('./audit');

const API = TEST_API_BASE_URL;
const identities = [];
const createdDocIds = [];
const createdAuditIds = [];

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
  }
  if (createdAuditIds.length > 0) {
    await AuditEvent.deleteMany({ _id: { $in: createdAuditIds } }, { allowTestCleanup: true });
  }
  await cleanupTestIdentities(identities);
}

async function runRegressionTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi RBAC & Authorization Regression Tests');
  console.log('====================================================\n');

  await mongoose.connect(TEST_MONGODB_URI);

  try {
    // 1. Setup Identities
    const citizenAlice = await createTestIdentity('Citizen');
    identities.push(citizenAlice);
    const aliceFetch = makeAuthenticatedFetch(citizenAlice.cookie);

    const citizenBob = await createTestIdentity('Citizen');
    identities.push(citizenBob);
    const bobFetch = makeAuthenticatedFetch(citizenBob.cookie);

    const officerAssigned = await createTestIdentity('Officer');
    identities.push(officerAssigned);
    const assignedOfficerFetch = makeAuthenticatedFetch(officerAssigned.cookie);

    const officerUnassigned = await createTestIdentity('Officer');
    identities.push(officerUnassigned);
    const unassignedOfficerFetch = makeAuthenticatedFetch(officerUnassigned.cookie);

    const adminUser = await createTestIdentity('Admin');
    identities.push(adminUser);
    const adminFetch = makeAuthenticatedFetch(adminUser.cookie);

    // 2. Create Base Documents
    // Doc 1: Alice's document, assigned to officerAssigned
    const docAlice = new Document({
      ownerId: citizenAlice.user._id,
      assignedOfficerId: officerAssigned.user._id,
      fileMetadata: {
        originalFilename: 'Alice_Deed_101.pdf',
        storedFilename: 'test_alice_101.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256Hash: 'hash-alice-101-sha256',
        storagePath: path.resolve(__dirname, 'uploads', 'test_alice_101.pdf')
      },
      status: 'Uploaded',
      landDetails: {
        ownerName: { value: 'Alice Sharma' },
        khasraNumber: { value: '101/A' },
        surveyNumber: { value: '101/A' },
        khataNumber: { value: '00010' },
        landArea: { value: '2.5000', unit: 'Acre' },
        village: { value: 'Rampur' },
        tehsil: { value: 'Sadar' },
        district: { value: 'Lucknow' },
        landClassification: { value: 'Agricultural' }
      }
    });
    await docAlice.save();
    createdDocIds.push(docAlice._id);

    // Doc 2: Bob's document, unassigned
    const docBob = new Document({
      ownerId: citizenBob.user._id,
      fileMetadata: {
        originalFilename: 'Bob_Deed_202.pdf',
        storedFilename: 'test_bob_202.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256Hash: 'hash-bob-202-sha256',
        storagePath: path.resolve(__dirname, 'uploads', 'test_bob_202.pdf')
      },
      status: 'Uploaded',
      landDetails: {
        ownerName: { value: 'Bob Verma' },
        khasraNumber: { value: '101/A' }, // Same parcel as Alice to test conflict isolation
        khataNumber: { value: '00010' },
        landArea: { value: '2.5000', unit: 'Acre' },
        village: { value: 'Rampur' },
        tehsil: { value: 'Sadar' },
        district: { value: 'Lucknow' }
      }
    });
    await docBob.save();
    createdDocIds.push(docBob._id);

    // ----------------------------------------------------
    // PRIORITY 1: Citizen modification / approval protections
    // ----------------------------------------------------
    console.log('[Priority 1] Testing Citizen status and modification restrictions...');

    // 1. Citizen cannot set status to Verified
    const verifyAttempt = await aliceFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Verified' })
    });
    assert.equal(verifyAttempt.status, 403, 'Citizen must not be able to set status to Verified');
    console.log('  ✓ Pass 1: Citizen cannot set status to Verified (403)');

    // 2. Citizen cannot set status to Rejected
    const rejectAttempt = await aliceFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Rejected' })
    });
    assert.equal(rejectAttempt.status, 403, 'Citizen must not be able to set status to Rejected');
    console.log('  ✓ Pass 2: Citizen cannot set status to Rejected (403)');

    // 3. Citizen cannot overwrite official land details after processing
    // First simulate processed document
    await Document.updateOne({ _id: docAlice._id }, { $set: { status: 'Needs review' } });
    const overwriteAttempt = await aliceFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        landDetails: {
          ownerName: { value: 'Tampered Name' }
        }
      })
    });
    assert.equal(overwriteAttempt.status, 403, 'Citizen must not be able to overwrite official land details after processing');
    console.log('  ✓ Pass 3: Citizen cannot overwrite official land details after processing (403)');

    // Reset status back to Needs review
    await Document.updateOne({ _id: docAlice._id }, { $set: { status: 'Needs review' } });

    // 4. Citizen cannot modify another user's document
    const modifyOtherAttempt = await aliceFetch(`${API}/documents/${docBob._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Sneaky modification' })
    });
    assert.equal(modifyOtherAttempt.status, 404, 'Citizen modifying another user document must return 404');
    console.log('  ✓ Pass 4: Citizen cannot modify another user document (404)');

    // 5. Assigned Officer can perform permitted review actions
    const officerSaveDraft = await assignedOfficerFetch(`${API}/documents/${docAlice._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        remarks: 'Draft review note',
        landDetails: {
          ownerName: { value: 'Alice Sharma Verified' }
        }
      })
    });
    assert.equal(officerSaveDraft.status, 200, 'Assigned officer must be able to save review draft');

    const officerApprove = await assignedOfficerFetch(`${API}/documents/${docAlice._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'approve',
        remarks: 'Land title verified against physical deed'
      })
    });
    assert.equal(officerApprove.status, 200, 'Assigned officer must be able to approve document');
    const approvedDoc = await officerApprove.json();
    assert.equal(approvedDoc.status, 'Verified');
    console.log('  ✓ Pass 5: Assigned Officer can perform review actions (save draft & approve)');

    // 6. Unassigned Officer cannot review document
    const unassignedReviewAttempt = await unassignedOfficerFetch(`${API}/documents/${docAlice._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reject',
        remarks: 'Unassigned rejection attempt'
      })
    });
    assert.equal(unassignedReviewAttempt.status, 404, 'Unassigned officer cannot access document review (404)');
    console.log('  ✓ Pass 6: Unassigned Officer cannot review document (404)');

    // 7. Admin retains intended permissions (reassign, review, manage)
    const adminAssign = await adminFetch(`${API}/documents/${docBob._id}/assignment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedOfficerId: officerUnassigned.user._id.toString() })
    });
    assert.equal(adminAssign.status, 200, 'Admin can assign unassigned document');
    console.log('  ✓ Pass 7: Admin retains administrative assignment permissions');

    // ----------------------------------------------------
    // PRIORITY 3: Audit history consistency
    // ----------------------------------------------------
    console.log('\n[Priority 3] Testing audit timeline consistency across event types...');

    // A. Record security audit event via server/services/audit.js
    const secEvent = await recordSecurityAudit({
      action: 'DOCUMENT_APPROVED',
      actorId: officerAssigned.user._id,
      role: 'Officer',
      resourceType: 'DOCUMENT',
      resourceId: docAlice._id.toString(),
      description: 'Document approved by assigned revenue officer',
      outcome: 'SUCCESS',
      metadata: { remarks: 'Priority 3 test approval' }
    });
    if (secEvent) createdAuditIds.push(secEvent._id);

    // B. Record document field diff audit event via server/audit.js
    const diffEvent = await recordDocumentAudit({
      documentId: docAlice._id,
      action: 'FIELD_EDITS_SAVED',
      actor: { id: officerAssigned.user._id.toString(), role: 'Officer', type: 'OFFICER' },
      description: 'Field edits saved for Alice deed',
      details: {
        diffs: [{ field: 'ownerName', before: 'Alice Sharma', after: 'Alice Sharma Verified' }]
      },
      outcome: 'SUCCESS'
    });
    if (diffEvent) createdAuditIds.push(diffEvent._id);

    // C. Record unrelated security event for a different resource
    const unrelatedDocId = new mongoose.Types.ObjectId();
    const unrelatedEvent = await recordSecurityAudit({
      action: 'DOCUMENT_REJECTED',
      actorId: officerAssigned.user._id,
      role: 'Officer',
      resourceType: 'DOCUMENT',
      resourceId: unrelatedDocId.toString(),
      description: 'Unrelated document rejection',
      outcome: 'SUCCESS'
    });
    if (unrelatedEvent) createdAuditIds.push(unrelatedEvent._id);

    // D. Fetch document audit timeline
    const timelineRes = await aliceFetch(`${API}/documents/${docAlice._id}/audit`);
    assert.equal(timelineRes.status, 200);
    const timelineData = await timelineRes.json();
    const eventActions = timelineData.events.map(e => e.action);

    assert.ok(eventActions.includes('DOCUMENT_APPROVED'), 'Document timeline must include security DOCUMENT_APPROVED event');
    assert.ok(eventActions.includes('FIELD_EDITS_SAVED'), 'Document timeline must include FIELD_EDITS_SAVED event');
    assert.ok(!timelineData.events.some(e => String(e.resourceId || e.documentId) === String(unrelatedDocId)), 'Timeline must NOT include unrelated events');
    console.log('  ✓ Pass: Document audit timeline retrieves both security & field diff events without unrelated events');

    // ----------------------------------------------------
    // PRIORITY 4: Duplicate & Conflict detection scoping
    // ----------------------------------------------------
    console.log('\n[Priority 4] Testing duplicate and conflict detection role scoping & cross-user isolation...');

    // Alice runs conflict analysis on her document (docAlice)
    // Note: docBob has the exact same parcel 101/A in Rampur, Lucknow, but is owned by Bob
    const aliceConflictRes = await aliceFetch(`${API}/documents/${docAlice._id}/conflicts?refresh=true`);
    assert.equal(aliceConflictRes.status, 200);
    const aliceConflictData = await aliceConflictRes.json();

    // Alice's candidate search must NOT leak Bob's document
    const aliceDetectedTargets = [
      ...(aliceConflictData.duplicateDetection?.matches || []).map(m => String(m.targetDocumentId)),
      ...(aliceConflictData.conflictDetection?.conflicts || []).map(c => String(c.targetDocumentId))
    ];
    assert.ok(!aliceDetectedTargets.includes(String(docBob._id)), 'Citizen Alice must NOT match against Citizen Bob document in conflict analysis');
    console.log('  ✓ Pass: Cross-user isolation enforced for Citizen in duplicate/conflict analysis');

    // ----------------------------------------------------
    // PRIORITY 5: Document listing and access consistency
    // ----------------------------------------------------
    console.log('\n[Priority 5] Testing document listing and individual document access consistency...');

    // Citizen Alice lists documents
    const aliceListing = await (await aliceFetch(`${API}/documents`)).json();
    const aliceVisibleIds = aliceListing.map(d => String(d._id));
    assert.ok(aliceVisibleIds.includes(String(docAlice._id)), 'Alice must see docAlice in list');
    assert.ok(!aliceVisibleIds.includes(String(docBob._id)), 'Alice must NOT see docBob in list');

    // Direct access to visible document succeeds
    const aliceOpenOwn = await aliceFetch(`${API}/documents/${docAlice._id}`);
    assert.equal(aliceOpenOwn.status, 200, 'Alice can open visible docAlice');

    // Direct access to invisible document returns 404
    const aliceOpenBob = await aliceFetch(`${API}/documents/${docBob._id}`);
    assert.equal(aliceOpenBob.status, 404, 'Alice cannot open docBob (returns 404)');

    // Officer assigned to docBob (officerUnassigned) can list and open docBob, but not docAlice
    const officerListing = await (await unassignedOfficerFetch(`${API}/documents`)).json();
    const officerVisibleIds = officerListing.map(d => String(d._id));
    assert.ok(officerVisibleIds.includes(String(docBob._id)), 'Assigned Officer must see docBob in list');
    assert.ok(!officerVisibleIds.includes(String(docAlice._id)), 'Unassigned Officer must NOT see docAlice in list');

    const officerOpenBob = await unassignedOfficerFetch(`${API}/documents/${docBob._id}`);
    assert.equal(officerOpenBob.status, 200, 'Assigned Officer can open docBob');

    const officerOpenAlice = await unassignedOfficerFetch(`${API}/documents/${docAlice._id}`);
    assert.equal(officerOpenAlice.status, 404, 'Unassigned Officer cannot open docAlice (returns 404)');

    console.log('  ✓ Pass: Document listing and individual document access are strictly consistent');

    // ----------------------------------------------------
    // PRIORITY 6: Anti-enumeration 404 vs 401 response consistency
    // ----------------------------------------------------
    console.log('\n[Priority 6] Testing anti-enumeration response policy across all document sub-routes...');

    // 1. Details endpoint
    const unauthDetails = await aliceFetch(`${API}/documents/${docBob._id}`);
    assert.equal(unauthDetails.status, 404, 'Unauthorized details must return 404');

    // 2. Conflicts endpoint
    const unauthConflicts = await aliceFetch(`${API}/documents/${docBob._id}/conflicts`);
    assert.equal(unauthConflicts.status, 404, 'Unauthorized conflicts must return 404');

    // 3. Conflicts analyze endpoint
    const unauthAnalyze = await aliceFetch(`${API}/documents/${docBob._id}/conflicts/analyze`, { method: 'POST' });
    assert.equal(unauthAnalyze.status, 404, 'Unauthorized analyze must return 404');

    // 4. Update endpoint
    const unauthUpdate = await aliceFetch(`${API}/documents/${docBob._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'Sneaky' })
    });
    assert.equal(unauthUpdate.status, 404, 'Unauthorized update must return 404');

    // 5. Audit history endpoint
    const unauthAudit = await aliceFetch(`${API}/documents/${docBob._id}/audit`);
    assert.equal(unauthAudit.status, 404, 'Unauthorized audit history must return 404');

    // 6. Integrity verification endpoint (POST and GET)
    const unauthVerifyPost = await aliceFetch(`${API}/documents/${docBob._id}/verify-integrity`, { method: 'POST' });
    assert.equal(unauthVerifyPost.status, 404, 'Unauthorized POST /verify-integrity must return 404');

    const unauthVerifyGet = await aliceFetch(`${API}/documents/${docBob._id}/verify-integrity`);
    assert.equal(unauthVerifyGet.status, 404, 'Unauthorized GET /verify-integrity must return 404');

    // 7. Verify 401 is preserved for unauthenticated requests
    const anonDetails = await fetch(`${API}/documents/${docBob._id}`);
    assert.equal(anonDetails.status, 401, 'Unauthenticated details must return 401');

    const anonConflicts = await fetch(`${API}/documents/${docBob._id}/conflicts`);
    assert.equal(anonConflicts.status, 401, 'Unauthenticated conflicts must return 401');

    const anonAudit = await fetch(`${API}/documents/${docBob._id}/audit`);
    assert.equal(anonAudit.status, 401, 'Unauthenticated audit must return 401');

    console.log('  ✓ Pass: All unauthorized document sub-routes return 404, unauthenticated returns 401');

    // ----------------------------------------------------
    // PRIORITY 8: Verify no spoofable actor extraction
    // ----------------------------------------------------
    console.log('\n[Priority 8] Testing audit actor extraction rejection of spoofable headers...');
    const { extractActor } = require('./audit');

    // Request with spoofed headers but no authenticated user
    const spoofedActor = extractActor({
      headers: {
        'x-user-id': '507f1f77bcf86cd799439011',
        'x-user-role': 'Admin'
      }
    });
    assert.equal(spoofedActor.id, null, 'Spoofed x-user-id header must be ignored');
    assert.equal(spoofedActor.role, null, 'Spoofed x-user-role header must be ignored');
    assert.equal(spoofedActor.type, 'ANONYMOUS', 'Unauthenticated request must produce ANONYMOUS actor');
    console.log('  ✓ Pass: Spoofed identity headers rejected; only authenticated req.user is trusted');

    // ----------------------------------------------------
    // SECURITY FIXES: Reprocessing protections & generic PATCH status lock
    // ----------------------------------------------------
    console.log('\n[Security Fixes] Testing reprocessing protections and formal review lock...');

    // 1. Citizen cannot reprocess a Rejected document -> 409
    await Document.updateOne({ _id: docAlice._id }, { $set: { status: 'Rejected' } });
    const reprocessRejectedRes = await aliceFetch(`${API}/documents/${docAlice._id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'gemini' })
    });
    assert.equal(reprocessRejectedRes.status, 409, 'Citizen reprocessing a Rejected document must return 409 Conflict');
    console.log('  ✓ Pass: Citizen cannot reprocess a Rejected document (409)');

    // 2. Citizen cannot reprocess a Verified document -> 409
    await Document.updateOne({ _id: docAlice._id }, { $set: { status: 'Verified' } });
    const reprocessVerifiedRes = await aliceFetch(`${API}/documents/${docAlice._id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'gemini' })
    });
    assert.equal(reprocessVerifiedRes.status, 409, 'Citizen reprocessing a Verified document must return 409 Conflict');
    console.log('  ✓ Pass: Citizen cannot reprocess a Verified document (409)');

    // 3. Officer cannot reprocess a document assigned to someone else -> 404
    const unassignedProcessRes = await unassignedOfficerFetch(`${API}/documents/${docAlice._id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'gemini' })
    });
    assert.equal(unassignedProcessRes.status, 404, 'Unassigned officer reprocessing document must return 404 Not Found');
    console.log('  ✓ Pass: Officer cannot reprocess an unassigned document (404)');

    // 4. Admin cannot reprocess a document outside allowed state transition -> 409
    const adminReprocessRes = await adminFetch(`${API}/documents/${docAlice._id}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'gemini' })
    });
    assert.equal(adminReprocessRes.status, 409, 'Admin reprocessing a non-Uploaded document must return 409 Conflict');
    console.log('  ✓ Pass: Admin cannot reprocess outside allowed state transition (409)');

    // 5. Generic PATCH cannot set status to Verified or Rejected for Officer or Admin -> 400
    const officerPatchVerified = await assignedOfficerFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Verified' })
    });
    assert.equal(officerPatchVerified.status, 400, 'Generic PATCH cannot set status to Verified for Officer (400)');

    const officerPatchRejected = await assignedOfficerFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Rejected' })
    });
    assert.equal(officerPatchRejected.status, 400, 'Generic PATCH cannot set status to Rejected for Officer (400)');

    const adminPatchVerified = await adminFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Verified' })
    });
    assert.equal(adminPatchVerified.status, 400, 'Generic PATCH cannot set status to Verified for Admin (400)');

    const adminPatchRejected = await adminFetch(`${API}/documents/${docAlice._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Rejected' })
    });
    assert.equal(adminPatchRejected.status, 400, 'Generic PATCH cannot set status to Rejected for Admin (400)');
    console.log('  ✓ Pass: Generic PATCH cannot set status to Verified or Rejected for Officer/Admin (400)');

    // 6. Dedicated review endpoint still works for authorized Officers/Admins
    await Document.updateOne({ _id: docAlice._id }, { $set: { status: 'Needs review' } });
    const officerReviewApprove = await assignedOfficerFetch(`${API}/documents/${docAlice._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', remarks: 'Formally approved through dedicated endpoint' })
    });
    assert.equal(officerReviewApprove.status, 200, 'Dedicated review endpoint succeeds for assigned officer');
    assert.equal((await officerReviewApprove.json()).status, 'Verified');
    console.log('  ✓ Pass: Dedicated review endpoint works for authorized Officers/Admins');

    // 7. Concurrency-safe processing: two simultaneous requests cannot both start processing
    const fs = require('fs');
    const { uploadDir } = require('./middleware/upload');
    const concurrentStoredName = `concurrent_test_${Date.now()}.pdf`;
    const concurrentFilePath = path.resolve(uploadDir, concurrentStoredName);
    await fs.promises.writeFile(concurrentFilePath, 'dummy pdf content for concurrent test');

    const docConcurrent = new Document({
      ownerId: citizenAlice.user._id,
      fileMetadata: {
        originalFilename: 'Concurrent_Test.pdf',
        storedFilename: concurrentStoredName,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: 'hash-concurrent-test',
        storagePath: concurrentFilePath
      },
      status: 'Uploaded',
      landDetails: {}
    });
    await docConcurrent.save();
    createdDocIds.push(docConcurrent._id);

    try {
      const [res1, res2] = await Promise.all([
        aliceFetch(`${API}/documents/${docConcurrent._id}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: 'gemini' })
        }),
        aliceFetch(`${API}/documents/${docConcurrent._id}/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engine: 'gemini' })
        })
      ]);

      const statuses = [res1.status, res2.status];
      assert.ok(statuses.includes(409), `At least one concurrent process request must receive 409 Conflict, got ${statuses.join(', ')}`);
      console.log('  ✓ Pass: Concurrency-safe atomic transition blocks simultaneous processing (409 Conflict)');
    } finally {
      await fs.promises.unlink(concurrentFilePath).catch(() => {});
    }

    console.log('\n====================================================');
    console.log('All RBAC & Authorization Regression Tests Passed! ✓');
    console.log('====================================================\n');
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

runRegressionTests().catch(err => {
  console.error('\n❌ Regression test failure:', err);
  process.exitCode = 1;
});
