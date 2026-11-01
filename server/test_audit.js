const express = require('express');
const mongoose = require('mongoose');
const assert = require('assert');
const path = require('path');
const http = require('http');

const documentRoutes = require('./routes/documents');
const Document = require('./models/Document');
const AuditEvent = require('./models/AuditEvent');
const {
  sanitizeAuditDetails,
  extractActor,
  computeFieldDiffs,
  recordAuditEvent
} = require('./audit');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';
const TEST_PORT = 5056;

const createdDocIds = [];
const createdAuditIds = [];

async function cleanup() {
  if (createdDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: createdDocIds } });
  }
  if (createdAuditIds.length > 0) {
    await AuditEvent.deleteMany({ _id: { $in: createdAuditIds } }, { allowTestCleanup: true });
  }
}

async function runAuditTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Phase 4 Audit History & Trail Tests');
  console.log('====================================================\n');

  await mongoose.connect(MONGODB_URI);

  // Set up Express test instance
  const app = express();
  app.use(express.json());
  app.use('/api/documents', documentRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  const baseUrl = `http://localhost:${TEST_PORT}/api/documents`;

  try {
    // ----------------------------------------------------
    // TEST 1: Sanitization and Sensitive Data Leakage Prevention
    // ----------------------------------------------------
    console.log('[TEST 1] Verifying sensitive data sanitization & leakage prevention...');
    const sensitivePayload = {
      ownerName: 'Rohan Sharma',
      storagePath: 'C:\\Users\\rohan\\DigiBhoomi\\server\\uploads\\secret_doc.pdf',
      serverFilePath: '/var/app/uploads/12345.pdf',
      token: 'jwt-super-secret-token-12345',
      apiKey: 'AIzaSyTestApiKeySecret',
      password: 'mySecretPassword',
      credential: { secretKey: 'xyz' },
      safeField: 'Safe Land Detail Value'
    };
    const sanitized = sanitizeAuditDetails(sensitivePayload);

    assert.strictEqual(sanitized.storagePath, undefined, 'storagePath should be stripped');
    assert.strictEqual(sanitized.token, undefined, 'token should be stripped');
    assert.strictEqual(sanitized.apiKey, undefined, 'apiKey should be stripped');
    assert.strictEqual(sanitized.password, undefined, 'password should be stripped');
    assert.strictEqual(sanitized.credential, undefined, 'credential should be stripped');
    assert.strictEqual(sanitized.safeField, 'Safe Land Detail Value', 'safeField should be preserved');
    assert.strictEqual(sanitized.serverFilePath, '[PROTECTED_SERVER_PATH]', 'Server uploads path should be masked');
    console.log('  ✓ Sensitive data and filesystem paths successfully protected.\n');

    // ----------------------------------------------------
    // TEST 2: Before / After Field Diffs Calculation
    // ----------------------------------------------------
    console.log('[TEST 2] Verifying field diffs computation for land details...');
    const oldLandDetails = {
      ownerName: { value: 'Rohan Sharma' },
      khasraNumber: { value: '101/1' },
      landArea: { value: '2.50', unit: 'Acre' },
      village: { value: 'Rampur' }
    };
    const newLandDetails = {
      ownerName: { value: 'Rohan Verma' }, // changed
      khasraNumber: { value: '101/1' }, // unchanged
      landArea: { value: '3.00', unit: 'Acre' }, // changed
      village: { value: 'Shyampur' } // changed
    };

    const diffs = computeFieldDiffs(oldLandDetails, newLandDetails);
    assert.strictEqual(diffs.length, 3, 'Should detect exactly 3 modified fields');

    const ownerDiff = diffs.find(d => d.field === 'ownerName');
    assert.ok(ownerDiff, 'ownerName diff must exist');
    assert.strictEqual(ownerDiff.before, 'Rohan Sharma');
    assert.strictEqual(ownerDiff.after, 'Rohan Verma');

    const areaDiff = diffs.find(d => d.field === 'landArea');
    assert.ok(areaDiff, 'landArea diff must exist');
    assert.strictEqual(areaDiff.before, '2.50 Acre');
    assert.strictEqual(areaDiff.after, '3.00 Acre');

    console.log('  ✓ Field diffs accurately computed before and after values.\n');

    // ----------------------------------------------------
    // TEST 3: Actor Identity Extraction & Untrusted Input Rejection
    // ----------------------------------------------------
    console.log('[TEST 3] Verifying actor identity extraction and missing actor fallback...');
    // Case A: Missing headers -> ANONYMOUS
    const anonymousActor = extractActor({ headers: {} });
    assert.strictEqual(anonymousActor.id, null);
    assert.strictEqual(anonymousActor.role, null);
    assert.strictEqual(anonymousActor.type, 'ANONYMOUS');

    // Case B: Authenticated Officer
    const officerActor = extractActor({
      headers: { 'x-user-id': 'officer-99', 'x-user-role': 'officer' }
    });
    assert.strictEqual(officerActor.id, 'officer-99');
    assert.strictEqual(officerActor.role, 'officer');
    assert.strictEqual(officerActor.type, 'OFFICER');

    // Case C: Authenticated User
    const userActor = extractActor({
      headers: { 'x-user-id': 'user-123', 'x-user-role': 'user' }
    });
    assert.strictEqual(userActor.id, 'user-123');
    assert.strictEqual(userActor.role, 'user');
    assert.strictEqual(userActor.type, 'USER');

    console.log('  ✓ Actor identity verified server-side with reliable fallback.\n');

    // ----------------------------------------------------
    // TEST 4: Document Creation & Upload Event Logging
    // ----------------------------------------------------
    console.log('[TEST 4] Creating document and testing upload audit event...');
    const testDoc = new Document({
      fileMetadata: {
        originalFilename: 'Audit_Test_Document.pdf',
        storedFilename: 'test_audit_doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 4096,
        sha256Hash: 'audit-test-hash-1234567890',
        storagePath: 'C:\\Users\\rohan\\DigiBhoomi\\server\\uploads\\test_audit_doc.pdf'
      },
      accessControl: {
        uploadedBy: 'user-alice',
        isPrivate: true
      },
      status: 'Uploaded',
      landDetails: {
        ownerName: { value: 'Suresh Kumar' },
        khasraNumber: { value: '45/1' },
        village: { value: 'Govindpur' }
      }
    });
    await testDoc.save();
    createdDocIds.push(testDoc._id);

    // Record upload audit event
    const uploadEvt = await recordAuditEvent({
      documentId: testDoc._id,
      action: 'DOCUMENT_UPLOADED',
      actor: { id: 'user-alice', role: 'user', type: 'USER' },
      description: `Document '${testDoc.fileMetadata.originalFilename}' uploaded.`,
      details: {
        filename: testDoc.fileMetadata.originalFilename,
        mimeType: testDoc.fileMetadata.mimeType,
        sizeBytes: testDoc.fileMetadata.sizeBytes,
        storagePath: testDoc.fileMetadata.storagePath // should be stripped!
      },
      outcome: 'SUCCESS'
    });
    assert.ok(uploadEvt, 'Upload event should be created in MongoDB');
    createdAuditIds.push(uploadEvt._id);
    assert.strictEqual(uploadEvt.details.storagePath, undefined, 'storagePath must be stripped in saved audit event');
    console.log('  ✓ Upload event recorded cleanly without internal path leakage.\n');

    // ----------------------------------------------------
    // TEST 5: Field Edits & Status Transitions via PATCH /api/documents/:id
    // ----------------------------------------------------
    console.log('[TEST 5] Testing field edits and review decisions with diff logging via PATCH...');
    const patchRes = await fetch(`${baseUrl}/${testDoc._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'officer-bob',
        'x-user-role': 'officer'
      },
      body: JSON.stringify({
        landDetails: {
          ownerName: { value: 'Suresh Kumar Sharma' }, // modified
          khasraNumber: { value: '45/1' },
          village: { value: 'Govindpur Kalan' } // modified
        },
        status: 'Needs review'
      })
    });

    assert.strictEqual(patchRes.status, 200, 'PATCH should succeed for authorized officer');
    const updatedDocData = await patchRes.json();
    assert.strictEqual(updatedDocData.landDetails.ownerName.value, 'Suresh Kumar Sharma');

    // Verify FIELD_EDITS_SAVED event was created
    const fieldEditEvents = await AuditEvent.find({
      documentId: testDoc._id,
      action: 'FIELD_EDITS_SAVED'
    });
    assert.ok(fieldEditEvents.length >= 1, 'At least one FIELD_EDITS_SAVED event should exist');
    const latestEditEvt = fieldEditEvents[fieldEditEvents.length - 1];
    createdAuditIds.push(latestEditEvt._id);

    assert.strictEqual(latestEditEvt.actor.id, 'officer-bob');
    assert.strictEqual(latestEditEvt.actor.role, 'officer');
    assert.strictEqual(latestEditEvt.actor.type, 'OFFICER');
    assert.ok(latestEditEvt.details.diffs.length >= 2, 'Should capture both modified fields');

    // Test Status Transition to 'Verified'
    const statusRes = await fetch(`${baseUrl}/${testDoc._id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'officer-bob',
        'x-user-role': 'officer'
      },
      body: JSON.stringify({
        status: 'Verified'
      })
    });
    assert.strictEqual(statusRes.status, 200);

    const statusEvents = await AuditEvent.find({
      documentId: testDoc._id,
      action: 'STATUS_UPDATED'
    }).sort({ timestamp: 1 });
    assert.strictEqual(statusEvents.length, 2, 'Should have 2 status transition events');
    statusEvents.forEach(e => createdAuditIds.push(e._id));
    assert.strictEqual(statusEvents[0].details.newStatus, 'Needs review');
    assert.strictEqual(statusEvents[1].details.newStatus, 'Verified');
    console.log('  ✓ Field edits with diffs and review status transitions successfully audited.\n');

    // ----------------------------------------------------
    // TEST 6: Failed Operations Logging
    // ----------------------------------------------------
    console.log('[TEST 6] Testing failed operation logging (failure not masked as success)...');
    const failedOcrEvt = await recordAuditEvent({
      documentId: testDoc._id,
      action: 'OCR_PROCESSING_FAILED',
      actor: { id: null, role: null, type: 'SYSTEM' },
      description: 'OCR processing failed: External engine timeout.',
      details: {
        engine: 'gemini',
        language: 'hi'
      },
      outcome: 'FAILURE',
      errorMessage: 'External engine timeout after 30000ms'
    });
    assert.ok(failedOcrEvt);
    createdAuditIds.push(failedOcrEvt._id);
    assert.strictEqual(failedOcrEvt.outcome, 'FAILURE', 'Outcome must be FAILURE');
    assert.strictEqual(failedOcrEvt.errorMessage, 'External engine timeout after 30000ms');
    console.log('  ✓ Failed operation properly logged with FAILURE outcome.\n');

    // ----------------------------------------------------
    // TEST 7: Retrieval Endpoint, Chronological Sorting & Pagination
    // ----------------------------------------------------
    console.log('[TEST 7] Testing GET /api/documents/:id/audit chronological order & pagination...');

    // Fetch in chronological order (asc)
    const ascRes = await fetch(`${baseUrl}/${testDoc._id}/audit?sort=asc`, {
      headers: {
        'x-user-id': 'user-alice',
        'x-user-role': 'user'
      }
    });
    assert.strictEqual(ascRes.status, 200);
    const ascData = await ascRes.json();

    assert.strictEqual(ascData.sort, 'asc');
    assert.ok(ascData.events.length >= 4, 'Should return all recorded events');
    for (let i = 0; i < ascData.events.length - 1; i++) {
      const t1 = new Date(ascData.events[i].timestamp).getTime();
      const t2 = new Date(ascData.events[i + 1].timestamp).getTime();
      assert.ok(t1 <= t2, `Events must be in non-decreasing chronological order (t1=${t1}, t2=${t2})`);
    }

    // Fetch with pagination
    const pagedRes = await fetch(`${baseUrl}/${testDoc._id}/audit?page=1&limit=2&sort=asc`, {
      headers: {
        'x-user-id': 'user-alice',
        'x-user-role': 'user'
      }
    });
    assert.strictEqual(pagedRes.status, 200);
    const pagedData = await pagedRes.json();
    assert.strictEqual(pagedData.events.length, 2, 'Should paginate to limit=2');
    assert.strictEqual(pagedData.page, 1);
    assert.strictEqual(pagedData.limit, 2);
    assert.ok(pagedData.totalPages >= 2);

    console.log('  ✓ Chronological sorting and pagination verified.\n');

    // ----------------------------------------------------
    // TEST 8: Authorization Enforcement
    // ----------------------------------------------------
    console.log('[TEST 8] Testing authorization protection for private document audit history...');

    // Case A: Unauthorized other user (user-charlie) -> 403 Forbidden
    const unauthRes = await fetch(`${baseUrl}/${testDoc._id}/audit`, {
      headers: {
        'x-user-id': 'user-charlie',
        'x-user-role': 'user'
      }
    });
    assert.strictEqual(unauthRes.status, 403, 'Unauthorized user should be denied access (403)');

    // Case B: Anonymous unauthenticated user on private document -> 403 Forbidden
    const anonRes = await fetch(`${baseUrl}/${testDoc._id}/audit`);
    assert.strictEqual(anonRes.status, 403, 'Unauthenticated user on private doc should be denied (403)');

    // Case C: Reviewer Officer role -> 200 OK
    const officerRes = await fetch(`${baseUrl}/${testDoc._id}/audit`, {
      headers: {
        'x-user-id': 'officer-bob',
        'x-user-role': 'officer'
      }
    });
    assert.strictEqual(officerRes.status, 200, 'Officer should have authorized access');

    console.log('  ✓ Authorization properly restricts access to private audit history.\n');

    // ----------------------------------------------------
    // TEST 9: Append-Only / Immutability Enforcement
    // ----------------------------------------------------
    console.log('[TEST 9] Testing append-only immutability hooks on AuditEvent collection...');

    // Attempt updateOne
    let updateThrew = false;
    try {
      await AuditEvent.updateOne({ _id: uploadEvt._id }, { description: 'Tampered description' });
    } catch (err) {
      updateThrew = true;
      assert.ok(err.message.includes('immutable'), 'Error must mention immutability');
    }
    assert.strictEqual(updateThrew, true, 'Updating an audit event must be blocked');

    // Attempt deleteOne without allowTestCleanup flag
    let deleteThrew = false;
    try {
      await AuditEvent.deleteOne({ _id: uploadEvt._id });
    } catch (err) {
      deleteThrew = true;
      assert.ok(err.message.includes('append-only'), 'Error must mention append-only');
    }
    assert.strictEqual(deleteThrew, true, 'Deleting an audit event via standard API must be blocked');

    console.log('  ✓ Audit entries are strictly append-only and immutable.\n');

    console.log('====================================================');
    console.log('  All Audit History Tests PASSED Successfully! ✓');
    console.log('====================================================\n');

  } finally {
    await cleanup();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
}

runAuditTests().catch(err => {
  console.error('\n❌ Audit test failure:', err);
  process.exit(1);
});
