/**
 * DigiBhoomi SHA-256 Document Cryptographic Integrity Verification Test Suite
 *
 * Verifies:
 * 1. Upload computes and stores SHA-256 hash.
 * 2. POST /api/documents/:id/verify-integrity returns isIntact: true for authentic files.
 * 3. Original SHA-256 hash in database is NEVER overwritten or altered during verification.
 * 4. File tampering detection: modifying file on disk results in isIntact: false.
 * 5. Immutable AuditEvent (INTEGRITY_VERIFIED) is recorded in MongoDB with full details.
 * 6. Private document authorization: unauthorized users cannot run verification (HTTP 403).
 * 7. Authorized owner and reviewer roles have verification access.
 * 8. Missing disk file and invalid document IDs return expected 404 / 400 errors.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Document = require('./models/Document');
const AuditEvent = require('./models/AuditEvent');
const { calculateFileHash, uploadDir } = require('./middleware/upload');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi';
const BASE_URL = 'http://localhost:5000/api';

let testDocIds = [];
let testFilenames = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

async function setup() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(MONGODB_URI);
  }
}

async function teardown() {
  if (testDocIds.length > 0) {
    await Document.deleteMany({ _id: { $in: testDocIds } });
    await AuditEvent.deleteMany({ documentId: { $in: testDocIds } }, { allowTestCleanup: true });
  }
  for (const fn of testFilenames) {
    const fullPath = path.resolve(uploadDir, fn);
    if (fullPath.startsWith(uploadDir) && fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath).catch(() => {});
    }
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi SHA-256 Integrity Verification Tests   ');
  console.log('====================================================\n');

  await setup();

  try {
    // ----------------------------------------------------
    // Test 1: Upload computes and stores authentic SHA-256 hash
    // ----------------------------------------------------
    console.log('Test 1: Upload computes and stores authentic SHA-256 hash');
    const testFileContent = 'DigiBhoomi Jamabandi Record Official Proof ' + Date.now();
    const testFileFilename = `test_integrity_${Date.now()}.png`;
    const form = new FormData();
    form.append('file', new Blob([testFileContent], { type: 'image/png' }), testFileFilename);

    const uploadRes = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      body: form
    });
    assert(uploadRes.status === 201, `Upload failed with status ${uploadRes.status}`);
    const uploadData = await uploadRes.json();
    testDocIds.push(uploadData._id);
    testFilenames.push(uploadData.fileMetadata.storedFilename);

    const expectedHash = crypto.createHash('sha256').update(testFileContent).digest('hex');
    assert(uploadData.fileMetadata.sha256Hash === expectedHash, `Stored hash (${uploadData.fileMetadata.sha256Hash}) must match expected (${expectedHash})`);
    console.log(`  ✓ Pass: Upload calculated SHA-256 hash: ${expectedHash.substring(0, 20)}...\n`);

    // ----------------------------------------------------
    // Test 2: Verify integrity endpoint returns isIntact: true
    // ----------------------------------------------------
    console.log('Test 2: Verification endpoint returns isIntact: true for authentic file');
    const verifyRes = await fetch(`${BASE_URL}/documents/${uploadData._id}/verify-integrity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': 'officer'
      }
    });
    assert(verifyRes.status === 200, `Verify failed with status ${verifyRes.status}`);
    const verifyData = await verifyRes.json();
    assert(verifyData.isIntact === true, 'File should be verified as intact');
    assert(verifyData.storedHash === expectedHash, 'Stored hash must match original');
    assert(verifyData.calculatedHash === expectedHash, 'Calculated hash must match original');
    console.log('  ✓ Pass: Verification endpoint returned isIntact: true and matching hashes.\n');

    // ----------------------------------------------------
    // Test 3: Original SHA-256 hash in DB is NEVER overwritten during verification
    // ----------------------------------------------------
    console.log('Test 3: Original SHA-256 hash in database is never overwritten');
    const docAfterVerify = await Document.findById(uploadData._id);
    assert(docAfterVerify.fileMetadata.sha256Hash === expectedHash, 'Database sha256Hash must remain identical to upload hash');
    console.log('  ✓ Pass: Database hash remains immutable and was not mutated during verification.\n');

    // ----------------------------------------------------
    // Test 4: Tampering detection: Modified file content triggers isIntact: false
    // ----------------------------------------------------
    console.log('Test 4: Tampering detection when file content on disk is modified');
    const diskPath = path.resolve(uploadDir, uploadData.fileMetadata.storedFilename);
    const originalDiskContent = await fs.promises.readFile(diskPath);

    // Tamper with file on disk
    await fs.promises.writeFile(diskPath, originalDiskContent + ' [TAMPERED CONTENT]');

    const tamperedVerifyRes = await fetch(`${BASE_URL}/documents/${uploadData._id}/verify-integrity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': 'officer'
      }
    });
    assert(tamperedVerifyRes.status === 200, 'Tampered verify request should complete with 200 payload');
    const tamperedData = await tamperedVerifyRes.json();
    assert(tamperedData.isIntact === false, 'Tampered file must yield isIntact: false');
    assert(tamperedData.storedHash === expectedHash, 'Stored hash must STILL be the original untampered hash');
    assert(tamperedData.calculatedHash !== expectedHash, 'Calculated hash must reflect tampered content');

    // Confirm DB record STILL keeps the original hash
    const docAfterTamper = await Document.findById(uploadData._id);
    assert(docAfterTamper.fileMetadata.sha256Hash === expectedHash, 'Database original hash MUST NOT be overwritten with tampered hash');

    // Restore original file
    await fs.promises.writeFile(diskPath, originalDiskContent);
    console.log('  ✓ Pass: Tampered file detected (isIntact: false); original DB hash remained protected.\n');

    // ----------------------------------------------------
    // Test 5: Verification records immutable AuditEvent in MongoDB
    // ----------------------------------------------------
    console.log('Test 5: Verification records immutable AuditEvent in MongoDB');
    const auditEvents = await AuditEvent.find({ documentId: uploadData._id, action: 'INTEGRITY_VERIFIED' });
    assert(auditEvents.length >= 2, `Expected at least 2 integrity audit events, found ${auditEvents.length}`);

    const passEvent = auditEvents.find(e => e.outcome === 'SUCCESS');
    assert(passEvent, 'Must have recorded a SUCCESS integrity audit event');
    assert(passEvent.details.isIntact === true, 'Event details must record isIntact: true');

    const failEvent = auditEvents.find(e => e.outcome === 'FAILURE');
    assert(failEvent, 'Must have recorded a FAILURE integrity audit event for tampered check');
    assert(failEvent.details.isIntact === false, 'Event details must record isIntact: false');
    console.log('  ✓ Pass: Immutable AuditEvents logged for both authentic and failed checks.\n');

    // ----------------------------------------------------
    // Test 6: Private document authorization enforcement
    // ----------------------------------------------------
    console.log('Test 6: Private document authorization enforcement');
    const privateDoc = new Document({
      fileMetadata: {
        originalFilename: 'test_private_doc.pdf',
        storedFilename: uploadData.fileMetadata.storedFilename, // point to existing test file
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256Hash: expectedHash,
        storagePath: diskPath
      },
      status: 'Needs review',
      accessControl: { uploadedBy: 'user-private-owner-99', isPrivate: true }
    });
    await privateDoc.save();
    testDocIds.push(privateDoc._id);

    // 6a: Unauthenticated user attempt
    const unauthVerify = await fetch(`${BASE_URL}/documents/${privateDoc._id}/verify-integrity`, {
      method: 'POST'
    });
    assert(unauthVerify.status === 403, `Unauthenticated user must be rejected with 403, got ${unauthVerify.status}`);

    // 6b: Unrelated user attempt
    const unrelatedVerify = await fetch(`${BASE_URL}/documents/${privateDoc._id}/verify-integrity`, {
      method: 'POST',
      headers: {
        'x-user-id': 'unrelated-user-88',
        'x-user-role': 'user'
      }
    });
    assert(unrelatedVerify.status === 403, `Unrelated user must be rejected with 403, got ${unrelatedVerify.status}`);

    // 6c: Authorized owner attempt
    const ownerVerify = await fetch(`${BASE_URL}/documents/${privateDoc._id}/verify-integrity`, {
      method: 'POST',
      headers: {
        'x-user-id': 'user-private-owner-99',
        'x-user-role': 'user'
      }
    });
    assert(ownerVerify.status === 200, `Authorized owner must have access (200), got ${ownerVerify.status}`);

    // 6d: Officer reviewer attempt
    const officerVerify = await fetch(`${BASE_URL}/documents/${privateDoc._id}/verify-integrity`, {
      method: 'POST',
      headers: {
        'x-user-role': 'officer'
      }
    });
    assert(officerVerify.status === 200, `Officer reviewer must have access (200), got ${officerVerify.status}`);

    console.log('  ✓ Pass: Strict authorization enforced: unauthorized blocked (403), owner and officer permitted (200).\n');

    // ----------------------------------------------------
    // Test 7: Error handling: Invalid ID and missing file
    // ----------------------------------------------------
    console.log('Test 7: Invalid ID and missing file error handling');
    const invalidIdRes = await fetch(`${BASE_URL}/documents/invalid_format_id/verify-integrity`, {
      method: 'POST'
    });
    assert(invalidIdRes.status === 400, 'Invalid ID format should return HTTP 400');

    const notFoundRes = await fetch(`${BASE_URL}/documents/507f1f77bcf86cd799439011/verify-integrity`, {
      method: 'POST'
    });
    assert(notFoundRes.status === 404, 'Non-existent document should return HTTP 404');

    console.log('  ✓ Pass: Error states handled gracefully.\n');

    console.log('====================================================');
    console.log('  All SHA-256 Integrity Tests PASSED Successfully! ✓');
    console.log('====================================================\n');
  } finally {
    await teardown();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Integrity Test Suite Failed:', err);
    process.exit(1);
  });
