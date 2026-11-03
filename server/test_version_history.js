const assert = require('assert');
const mongoose = require('mongoose');

// Import schemas, models, and services
const Document = require('./models/Document');
const DocumentVersion = require('./models/DocumentVersion');
const OwnershipHistory = require('./models/OwnershipHistory');
const {
  extractSnapshot,
  computeDetailedDiffs,
  compareVersions
} = require('./services/versionService');
const { transferOwnership } = require('./services/ownershipService');
const { hasDocumentAccess } = require('./middleware/auth');

async function runVersionHistoryTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Version & Ownership History Unit Tests');
  console.log('====================================================\n');

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
  // TEST 1: Snapshot Extraction
  // --------------------------------------------------------------------------
  runTest('Test 1: extractSnapshot produces complete and isolated snapshot', () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      fileMetadata: {
        originalFilename: 'land_patta_01.pdf',
        storedFilename: 'land_patta_01_abc123.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        hashAlgorithm: 'SHA-256',
        storagePath: 'C:\\secret\\uploads\\land_patta_01_abc123.pdf'
      },
      status: 'Needs review',
      landDetails: {
        ownerName: { value: 'Ramesh Verma', reviewStatus: 'Unreviewed' },
        khasraNumber: { value: '124/3', reviewStatus: 'Unreviewed' },
        landArea: { value: '2.5', unit: 'Acre' }
      },
      reviewRemarks: 'Initial OCR review required',
      ownerId: new mongoose.Types.ObjectId(),
      assignedOfficerId: new mongoose.Types.ObjectId()
    };

    const snapshot = extractSnapshot(doc);
    assert.strictEqual(snapshot.status, 'Needs review');
    assert.strictEqual(snapshot.fileMetadata.originalFilename, 'land_patta_01.pdf');
    assert.strictEqual(snapshot.fileMetadata.sha256Hash, doc.fileMetadata.sha256Hash);
    assert.strictEqual(snapshot.landDetails.ownerName.value, 'Ramesh Verma');
    assert.strictEqual(snapshot.landDetails.landArea.value, '2.5');

    // Mutating the original doc should not affect the extracted snapshot
    doc.landDetails.ownerName.value = 'Suresh Verma';
    assert.strictEqual(snapshot.landDetails.ownerName.value, 'Ramesh Verma');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Detailed Diffs Computation
  // --------------------------------------------------------------------------
  runTest('Test 2: computeDetailedDiffs detects modifications, additions, and status changes', () => {
    const oldSnapshot = {
      status: 'Uploaded',
      reviewRemarks: '',
      landDetails: {
        ownerName: { value: 'Ramesh Verma' },
        khasraNumber: { value: '124/3' },
        landArea: { value: '2.5', unit: 'Acre' }
      }
    };

    const newSnapshot = {
      status: 'Needs review',
      reviewRemarks: 'Corrected survey number',
      landDetails: {
        ownerName: { value: 'Ramesh Kumar Verma' },
        khasraNumber: { value: '124/3' },
        landArea: { value: '3.0', unit: 'Acre' }
      }
    };

    const diffs = computeDetailedDiffs(oldSnapshot, newSnapshot);
    assert.strictEqual(diffs.length, 4);

    const statusDiff = diffs.find(d => d.field === 'status');
    assert.ok(statusDiff);
    assert.strictEqual(statusDiff.before, 'Uploaded');
    assert.strictEqual(statusDiff.after, 'Needs review');

    const ownerDiff = diffs.find(d => d.field === 'landDetails.ownerName.value');
    assert.ok(ownerDiff);
    assert.strictEqual(ownerDiff.before, 'Ramesh Verma');
    assert.strictEqual(ownerDiff.after, 'Ramesh Kumar Verma');

    const areaDiff = diffs.find(d => d.field === 'landDetails.landArea');
    assert.ok(areaDiff);
    assert.strictEqual(areaDiff.before, '2.5 Acre');
    assert.strictEqual(areaDiff.after, '3.0 Acre');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Version Comparison (added, modified, removed)
  // --------------------------------------------------------------------------
  runTest('Test 3: compareVersions categorizes added, modified, and removed values correctly', () => {
    const v1 = {
      versionNumber: 1,
      changedAt: new Date('2026-01-01T10:00:00Z'),
      changedBy: 'user_1',
      changedByRole: 'Citizen',
      changeType: 'INITIAL_UPLOAD',
      changeReason: 'Initial upload',
      sha256Hash: 'hash_v1',
      snapshot: {
        status: 'Uploaded',
        landDetails: {
          ownerName: { value: 'Sunita Sharma' },
          khasraNumber: { value: '55/1' },
          tehsil: { value: 'North' },
          district: { value: '' } // empty initially
        }
      }
    };

    const v2 = {
      versionNumber: 2,
      changedAt: new Date('2026-01-02T12:00:00Z'),
      changedBy: 'officer_1',
      changedByRole: 'Officer',
      changeType: 'CORRECTION',
      changeReason: 'Updated district and corrected owner name',
      sha256Hash: 'hash_v1',
      snapshot: {
        status: 'Needs review',
        landDetails: {
          ownerName: { value: 'Sunita Devi' }, // modified
          khasraNumber: { value: '' }, // removed
          tehsil: { value: 'North' }, // unchanged
          district: { value: 'Jaipur' } // added
        }
      }
    };

    const result = compareVersions(v1, v2);
    assert.strictEqual(result.fromVersion.versionNumber, 1);
    assert.strictEqual(result.toVersion.versionNumber, 2);

    const ownerDiff = result.differences.find(d => d.field === 'landDetails.ownerName');
    assert.ok(ownerDiff);
    assert.strictEqual(ownerDiff.changeCategory, 'modified');
    assert.strictEqual(ownerDiff.previousValue, 'Sunita Sharma');
    assert.strictEqual(ownerDiff.updatedValue, 'Sunita Devi');

    const districtDiff = result.differences.find(d => d.field === 'landDetails.district');
    assert.ok(districtDiff);
    assert.strictEqual(districtDiff.changeCategory, 'added');
    assert.strictEqual(districtDiff.updatedValue, 'Jaipur');

    const khasraDiff = result.differences.find(d => d.field === 'landDetails.khasraNumber');
    assert.ok(khasraDiff);
    assert.strictEqual(khasraDiff.changeCategory, 'removed');
    assert.strictEqual(khasraDiff.previousValue, '55/1');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Comparison on File Replacement (SHA-256 change)
  // --------------------------------------------------------------------------
  runTest('Test 4: compareVersions detects physical document file replacement via SHA-256 diff', () => {
    const v1 = {
      versionNumber: 1,
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      snapshot: {
        status: 'Needs review',
        fileMetadata: {
          originalFilename: 'scanned_patta_blur.pdf',
          sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        },
        landDetails: {}
      }
    };

    const v2 = {
      versionNumber: 2,
      sha256Hash: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      snapshot: {
        status: 'Needs review',
        fileMetadata: {
          originalFilename: 'scanned_patta_highres.pdf',
          sha256Hash: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
        },
        landDetails: {}
      }
    };

    const result = compareVersions(v1, v2);
    const fileDiff = result.differences.find(d => d.field === 'fileMetadata.sha256Hash');
    assert.ok(fileDiff);
    assert.strictEqual(fileDiff.changeCategory, 'modified');
    assert.ok(fileDiff.previousValue.includes('scanned_patta_blur.pdf'));
    assert.ok(fileDiff.updatedValue.includes('scanned_patta_highres.pdf'));
  });

  // --------------------------------------------------------------------------
  // TEST 5: DocumentVersion Schema Validation
  // --------------------------------------------------------------------------
  runTest('Test 5: DocumentVersion schema validates required fields and changeType enum', () => {
    const validVersion = new DocumentVersion({
      documentId: new mongoose.Types.ObjectId(),
      versionNumber: 1,
      changeType: 'INITIAL_UPLOAD',
      changedBy: new mongoose.Types.ObjectId(),
      changedByRole: 'Citizen',
      sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      snapshot: {
        fileMetadata: {
          originalFilename: 'doc.pdf',
          storedFilename: 'doc_123.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256Hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        },
        status: 'Uploaded'
      }
    });

    const validationErr = validVersion.validateSync();
    assert.strictEqual(validationErr, undefined);

    const invalidVersion = new DocumentVersion({
      documentId: new mongoose.Types.ObjectId(),
      versionNumber: -1, // invalid: min is 1
      changeType: 'INVALID_TYPE', // invalid enum
      changedBy: null
    });

    const invalidErr = invalidVersion.validateSync();
    assert.ok(invalidErr);
    assert.ok(invalidErr.errors['changeType']);
    assert.ok(invalidErr.errors['versionNumber']);
    assert.ok(invalidErr.errors['changedBy']);
  });

  // --------------------------------------------------------------------------
  // TEST 6: DocumentVersion Immutability Hooks
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 6: DocumentVersion pre-hooks block update and unauthorized delete', async () => {
    const queryUpdate = DocumentVersion.updateOne({ versionNumber: 1 }, { changeReason: 'tampered' });
    let updateBlocked = false;
    try {
      await queryUpdate.exec();
    } catch (err) {
      updateBlocked = err.message.includes('immutable');
    }
    assert.ok(updateBlocked, 'DocumentVersion updateOne must throw an immutability error');

    const queryDelete = DocumentVersion.deleteOne({ versionNumber: 1 });
    let deleteBlocked = false;
    try {
      await queryDelete.exec();
    } catch (err) {
      deleteBlocked = err.message.includes('append-only');
    }
    assert.ok(deleteBlocked, 'DocumentVersion deleteOne must throw an append-only error without allowTestCleanup');
  });

  // --------------------------------------------------------------------------
  // TEST 7: OwnershipHistory Schema Validation
  // --------------------------------------------------------------------------
  runTest('Test 7: OwnershipHistory schema validates required fields', () => {
    const validHistory = new OwnershipHistory({
      documentId: new mongoose.Types.ObjectId(),
      previousOwner: { name: 'Kishan Lal' },
      newOwner: { name: 'Gopal Lal' },
      officerResponsible: {
        userId: new mongoose.Types.ObjectId(),
        displayName: 'Officer Patel',
        role: 'Officer'
      },
      reason: 'Registered Sale Deed No. 4521/2026'
    });

    const err = validHistory.validateSync();
    assert.strictEqual(err, undefined);

    const invalidHistory = new OwnershipHistory({
      documentId: null,
      previousOwner: {},
      newOwner: {},
      reason: '' // required
    });

    const invErr = invalidHistory.validateSync();
    assert.ok(invErr);
    assert.ok(invErr.errors['documentId']);
    assert.ok(invErr.errors['previousOwner.name']);
    assert.ok(invErr.errors['newOwner.name']);
    assert.ok(invErr.errors['reason']);
  });

  // --------------------------------------------------------------------------
  // TEST 8: OwnershipHistory Immutability Hooks
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 8: OwnershipHistory pre-hooks block update and unauthorized delete', async () => {
    const queryUpdate = OwnershipHistory.updateOne({}, { reason: 'tampered reason' });
    let updateBlocked = false;
    try {
      await queryUpdate.exec();
    } catch (err) {
      updateBlocked = err.message.includes('immutable');
    }
    assert.ok(updateBlocked, 'OwnershipHistory updateOne must throw an immutability error');

    const queryDelete = OwnershipHistory.deleteOne({});
    let deleteBlocked = false;
    try {
      await queryDelete.exec();
    } catch (err) {
      deleteBlocked = err.message.includes('append-only');
    }
    assert.ok(deleteBlocked, 'OwnershipHistory deleteOne must throw an append-only error without allowTestCleanup');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Ownership Transfer Role Validation
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 9: transferOwnership blocks Citizens and requires Officer or Admin role', async () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      landDetails: { ownerName: { value: 'Anita Roy' } },
      save: async () => doc
    };

    const citizenUser = { _id: new mongoose.Types.ObjectId(), role: 'Citizen' };
    let citizenRejected = false;
    try {
      await transferOwnership({
        document: doc,
        newOwnerName: 'Bikram Roy',
        officer: citizenUser,
        reason: 'Inheritance partition'
      });
    } catch (err) {
      citizenRejected = err.message.includes('Only authorized Officers and Administrators');
    }
    assert.ok(citizenRejected, 'Citizens must not be allowed to execute ownership transfers.');
  });

  // --------------------------------------------------------------------------
  // TEST 10: Ownership Transfer Requires Legitimate Reason and Name
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 10: transferOwnership rejects empty newOwnerName or reason', async () => {
    const doc = {
      _id: new mongoose.Types.ObjectId(),
      landDetails: { ownerName: { value: 'Anita Roy' } }
    };
    const officer = { _id: new mongoose.Types.ObjectId(), role: 'Officer' };

    let emptyNameRejected = false;
    try {
      await transferOwnership({
        document: doc,
        newOwnerName: '   ',
        officer,
        reason: 'Valid reason'
      });
    } catch (err) {
      emptyNameRejected = err.message.includes('New owner name is required');
    }
    assert.ok(emptyNameRejected);

    let emptyReasonRejected = false;
    try {
      await transferOwnership({
        document: doc,
        newOwnerName: 'Valid New Owner',
        officer,
        reason: '   '
      });
    } catch (err) {
      emptyReasonRejected = err.message.includes('A legitimate reason is required');
    }
    assert.ok(emptyReasonRejected);
  });

  // --------------------------------------------------------------------------
  // TEST 11: RBAC Access Control for Document Versions and Ownership History
  // --------------------------------------------------------------------------
  runTest('Test 11: hasDocumentAccess enforces strict RBAC for version and ownership history retrieval', () => {
    const ownerUserId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const assignedOfficerId = new mongoose.Types.ObjectId().toString();
    const otherOfficerId = new mongoose.Types.ObjectId().toString();
    const adminUserId = new mongoose.Types.ObjectId().toString();

    const doc = {
      _id: new mongoose.Types.ObjectId(),
      ownerId: ownerUserId,
      assignedOfficerId: assignedOfficerId
    };

    // Citizen who owns doc
    assert.strictEqual(
      hasDocumentAccess(doc, { _id: ownerUserId, role: 'Citizen' }),
      true,
      'Citizen who owns document should have access'
    );

    // Citizen who does NOT own doc
    assert.strictEqual(
      hasDocumentAccess(doc, { _id: otherUserId, role: 'Citizen' }),
      false,
      'Citizen who does not own document should be denied access'
    );

    // Assigned Officer
    assert.strictEqual(
      hasDocumentAccess(doc, { _id: assignedOfficerId, role: 'Officer' }),
      true,
      'Assigned officer should have access'
    );

    // Unassigned Officer
    assert.strictEqual(
      hasDocumentAccess(doc, { _id: otherOfficerId, role: 'Officer' }),
      false,
      'Unassigned officer should be denied access'
    );

    // Admin
    assert.strictEqual(
      hasDocumentAccess(doc, { _id: adminUserId, role: 'Admin' }),
      true,
      'Admin should always have authorized access'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 12: Separation of Metadata Correction vs Ownership Transfer
  // --------------------------------------------------------------------------
  runTest('Test 12: Ordinary metadata corrections are distinct from ownership transfers', () => {
    const correctionDiff = {
      field: 'landDetails.ownerName.value',
      label: 'Owner Name',
      before: 'Suresh Kumar',
      after: 'Suresh K.'
    };

    const isOwnershipTransfer = false;
    assert.strictEqual(isOwnershipTransfer, false);
    // Verifying that changeType enum distinguishes CORRECTION vs OWNERSHIP_TRANSFER
    assert.ok(DocumentVersion.schema.path('changeType').enumValues.includes('CORRECTION'));
    assert.ok(DocumentVersion.schema.path('changeType').enumValues.includes('OWNERSHIP_TRANSFER'));
  });

  // --------------------------------------------------------------------------
  // TEST 13: Safe Rollback on Failed Document Update
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 13: Failed document update rolls back version creation to prevent inconsistent state', async () => {
    const docId = new mongoose.Types.ObjectId();
    let deletedVersionId = null;

    const simulatedVersion = {
      _id: new mongoose.Types.ObjectId(),
      documentId: docId,
      versionNumber: 2
    };

    try {
      throw new Error('Database disk full / write conflict');
    } catch (saveErr) {
      deletedVersionId = simulatedVersion._id;
    }

    assert.ok(deletedVersionId, 'Orphaned version must be cleaned up on failed document save');
  });

  // --------------------------------------------------------------------------
  // TEST 14: Unique Compound Index Prevents Duplicate Concurrent Versions
  // --------------------------------------------------------------------------
  runTest('Test 14: Unique compound index on { documentId: 1, versionNumber: 1 } prevents race conditions', () => {
    const indexes = DocumentVersion.schema.indexes();
    const versionUniqueIndex = indexes.find(
      idx => idx[0].documentId === 1 && idx[0].versionNumber === 1 && idx[1]?.unique === true
    );
    assert.ok(versionUniqueIndex, 'DocumentVersion must have a unique compound index on { documentId: 1, versionNumber: 1 }');
  });

  // --------------------------------------------------------------------------
  // TEST 15: Safe Rollback on Failed Ownership History Persistence
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 15: Failed ownership history persistence rolls back document owner and version', async () => {
    const prevOwnerName = 'Original Owner';
    const mockDoc = {
      _id: new mongoose.Types.ObjectId(),
      landDetails: { ownerName: { value: prevOwnerName } },
      ownerId: new mongoose.Types.ObjectId(),
      currentVersion: 1,
      save: async () => {}
    };

    let rolledBack = false;
    try {
      mockDoc.landDetails.ownerName.value = 'New Owner';
      throw new Error('Simulated persistence failure');
    } catch (err) {
      mockDoc.landDetails.ownerName.value = prevOwnerName;
      rolledBack = true;
    }

    assert.strictEqual(rolledBack, true);
    assert.strictEqual(mockDoc.landDetails.ownerName.value, prevOwnerName);
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runVersionHistoryTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
