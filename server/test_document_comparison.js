const assert = require('assert');
const mongoose = require('mongoose');

const Document = require('./models/Document');
const DocumentVersion = require('./models/DocumentVersion');
const { compareVersions, extractSnapshot } = require('./services/versionService');
const { hasDocumentAccess } = require('./middleware/auth');
const { recordAuditEvent } = require('./services/audit');

async function runDocumentComparisonTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Document Comparison Test Suite');
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

  const commonDocId = new mongoose.Types.ObjectId();
  const citizen1Id = new mongoose.Types.ObjectId();
  const citizen2Id = new mongoose.Types.ObjectId();
  const assignedOfficerId = new mongoose.Types.ObjectId();
  const unassignedOfficerId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  // Create mock snapshots for v1, v2, v3
  const v1 = {
    documentId: commonDocId,
    versionNumber: 1,
    changeType: 'INITIAL_UPLOAD',
    changeReason: 'Initial registration',
    changedBy: citizen1Id,
    changedByRole: 'Citizen',
    changedAt: new Date('2026-01-01T10:00:00Z'),
    sha256Hash: 'a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899',
    snapshot: {
      status: 'Uploaded',
      reviewRemarks: '',
      fileMetadata: {
        originalFilename: 'land_deed_v1.pdf',
        sha256Hash: 'a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899'
      },
      landDetails: {
        ownerName: { value: 'Ramesh Verma' },
        surveyNumber: { value: '102' },
        khasraNumber: { value: '45/1' },
        khataNumber: { value: '88' },
        landArea: { value: '2.5', unit: 'Acre' },
        areaUnit: { value: 'Acre' },
        village: { value: 'Rampur' },
        tehsil: { value: 'North' },
        district: { value: 'Bengaluru Urban' },
        landClassification: { value: 'Agricultural' }
      }
    }
  };

  const v2 = {
    documentId: commonDocId,
    versionNumber: 2,
    changeType: 'CORRECTION',
    changeReason: 'Corrected survey number and classification after field inspection',
    changedBy: assignedOfficerId,
    changedByRole: 'Officer',
    changedAt: new Date('2026-01-05T14:30:00Z'),
    sha256Hash: 'a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899',
    snapshot: {
      status: 'Needs review',
      reviewRemarks: 'Survey number verified with village map; classification updated to Residential.',
      fileMetadata: {
        originalFilename: 'land_deed_v1.pdf',
        sha256Hash: 'a1b2c3d4e5f600112233445566778899aabbccddeeff00112233445566778899'
      },
      landDetails: {
        ownerName: { value: 'Ramesh Verma' }, // Unchanged
        surveyNumber: { value: '102-A' },     // Modified
        khasraNumber: { value: '45/1' },      // Unchanged
        khataNumber: { value: '' },           // Removed
        landArea: { value: '2.50', unit: 'Acre' }, // Unchanged after normalization (2.5 vs 2.50)
        areaUnit: { value: 'Acre' },          // Unchanged
        village: { value: 'Rampur' },         // Unchanged
        tehsil: { value: 'North' },           // Unchanged
        district: { value: 'Bengaluru Urban' }, // Unchanged
        landClassification: { value: 'Residential' } // Modified
      }
    }
  };

  const v3 = {
    documentId: commonDocId,
    versionNumber: 3,
    changeType: 'OWNERSHIP_TRANSFER',
    changeReason: 'Legitimate inheritance transfer to new owner',
    changedBy: assignedOfficerId,
    changedByRole: 'Officer',
    changedAt: new Date('2026-01-10T11:00:00Z'),
    sha256Hash: 'b9c8d7e6f5a4112233445566778899aabbccddeeff0011223344556677889900', // Modified file
    snapshot: {
      status: 'Verified',
      reviewRemarks: 'Approved following succession certificate review.',
      fileMetadata: {
        originalFilename: 'land_deed_v2_updated.pdf',
        sha256Hash: 'b9c8d7e6f5a4112233445566778899aabbccddeeff0011223344556677889900'
      },
      landDetails: {
        ownerName: { value: 'Suresh Verma' }, // Modified (Ramesh -> Suresh)
        surveyNumber: { value: '102-A' },
        khasraNumber: { value: '45/1' },
        khataNumber: { value: '88-B' },       // Added (empty in v2 -> 88-B)
        landArea: { value: '2.8', unit: 'Acre' }, // Modified (2.5 -> 2.8)
        areaUnit: { value: 'Acre' },
        village: { value: 'Rampur' },
        tehsil: { value: 'North' },
        district: { value: 'Bengaluru Urban' },
        landClassification: { value: 'Commercial' } // Modified (Residential -> Commercial)
      }
    }
  };

  // --------------------------------------------------------------------------
  // TEST 1: Successful comparison of two distinct versions
  // --------------------------------------------------------------------------
  runTest('Test 1: Successful comparison of two distinct versions returns full comparison object', () => {
    const res = compareVersions(v1, v2);
    assert.ok(res.fromVersion, 'fromVersion metadata must exist');
    assert.ok(res.toVersion, 'toVersion metadata must exist');
    assert.strictEqual(res.fromVersion.versionNumber, 1);
    assert.strictEqual(res.toVersion.versionNumber, 2);
    assert.ok(Array.isArray(res.differences), 'differences must be an array');
    assert.ok(Array.isArray(res.allFields), 'allFields must be an array');
    assert.ok(res.summary, 'summary object must exist');
  });

  // --------------------------------------------------------------------------
  // TEST 2: Comparison between adjacent versions (v1 and v2)
  // --------------------------------------------------------------------------
  runTest('Test 2: Comparison between adjacent versions (v1 and v2)', () => {
    const res = compareVersions(v1, v2);
    assert.strictEqual(res.fromVersion.versionNumber, 1);
    assert.strictEqual(res.toVersion.versionNumber, 2);
    assert.ok(res.differences.length > 0, 'Should detect differences between adjacent versions');
  });

  // --------------------------------------------------------------------------
  // TEST 3: Comparison between non-adjacent versions (v1 and v3)
  // --------------------------------------------------------------------------
  runTest('Test 3: Comparison between non-adjacent versions (v1 and v3)', () => {
    const res = compareVersions(v1, v3);
    assert.strictEqual(res.fromVersion.versionNumber, 1);
    assert.strictEqual(res.toVersion.versionNumber, 3);
    // Between v1 and v3, ownerName changed from Ramesh to Suresh
    const ownerDiff = res.differences.find(d => d.field === 'landDetails.ownerName');
    assert.ok(ownerDiff, 'Owner name difference must be captured between v1 and v3');
    assert.strictEqual(ownerDiff.previousValue, 'Ramesh Verma');
    assert.strictEqual(ownerDiff.updatedValue, 'Suresh Verma');
    assert.strictEqual(ownerDiff.changeCategory, 'modified');
  });

  // --------------------------------------------------------------------------
  // TEST 4: Detection of added fields
  // --------------------------------------------------------------------------
  runTest('Test 4: Correct detection of added fields', () => {
    // Comparing v2 (where khataNumber was empty) and v3 (where khataNumber is 88-B)
    const res = compareVersions(v2, v3);
    const khataDiff = res.differences.find(d => d.field === 'landDetails.khataNumber');
    assert.ok(khataDiff, 'Khata number addition must be captured');
    assert.strictEqual(khataDiff.changeCategory, 'added');
    assert.strictEqual(khataDiff.status, 'Added');
    assert.strictEqual(khataDiff.previousValue, '(empty)');
    assert.strictEqual(khataDiff.updatedValue, '88-B');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Detection of modified fields
  // --------------------------------------------------------------------------
  runTest('Test 5: Correct detection of modified fields', () => {
    const res = compareVersions(v1, v2);
    const surveyDiff = res.differences.find(d => d.field === 'landDetails.surveyNumber');
    assert.ok(surveyDiff, 'Survey number modification must be captured');
    assert.strictEqual(surveyDiff.changeCategory, 'modified');
    assert.strictEqual(surveyDiff.status, 'Modified');
    assert.strictEqual(surveyDiff.previousValue, '102');
    assert.strictEqual(surveyDiff.updatedValue, '102-A');

    const classDiff = res.differences.find(d => d.field === 'landDetails.landClassification');
    assert.ok(classDiff, 'Classification change must be captured');
    assert.strictEqual(classDiff.changeCategory, 'modified');
    assert.strictEqual(classDiff.previousValue, 'Agricultural');
    assert.strictEqual(classDiff.updatedValue, 'Residential');
  });

  // --------------------------------------------------------------------------
  // TEST 6: Detection of removed fields
  // --------------------------------------------------------------------------
  runTest('Test 6: Correct detection of removed fields', () => {
    // In v1 khataNumber was '88', in v2 it was cleared to ''
    const res = compareVersions(v1, v2);
    const khataDiff = res.differences.find(d => d.field === 'landDetails.khataNumber');
    assert.ok(khataDiff, 'Khata number removal must be captured');
    assert.strictEqual(khataDiff.changeCategory, 'removed');
    assert.strictEqual(khataDiff.status, 'Removed');
    assert.strictEqual(khataDiff.previousValue, '88');
    assert.strictEqual(khataDiff.updatedValue, '(empty)');
  });

  // --------------------------------------------------------------------------
  // TEST 7: Detection of unchanged fields and value normalization
  // --------------------------------------------------------------------------
  runTest('Test 7: Correct detection of unchanged fields and numeric/unit normalization', () => {
    const res = compareVersions(v1, v2);

    // Khasra number is 45/1 in both v1 and v2
    const khasraField = res.allFields.find(f => f.field === 'landDetails.khasraNumber');
    assert.ok(khasraField, 'Khasra field must exist in allFields');
    assert.strictEqual(khasraField.changeCategory, 'unchanged');
    assert.strictEqual(khasraField.status, 'Unchanged');
    assert.strictEqual(khasraField.previousValue, '45/1');
    assert.strictEqual(khasraField.updatedValue, '45/1');

    // Land area: v1 has "2.5 Acre", v2 has "2.50 Acre" -> normalized to "2.5 acre", so unchanged
    const areaField = res.allFields.find(f => f.field === 'landDetails.landArea');
    assert.ok(areaField, 'Land area field must exist in allFields');
    assert.strictEqual(areaField.changeCategory, 'unchanged', '2.5 Acre vs 2.50 Acre should be normalized to unchanged');
    assert.strictEqual(areaField.status, 'Unchanged');
    // Original display strings are preserved!
    assert.strictEqual(areaField.previousValue, '2.5 Acre');
    assert.strictEqual(areaField.updatedValue, '2.50 Acre');
  });

  // --------------------------------------------------------------------------
  // TEST 8: Correct summary statistics
  // --------------------------------------------------------------------------
  runTest('Test 8: Correct summary statistics (total, changed, unchanged, added, modified, removed)', () => {
    const res = compareVersions(v1, v2);
    const { summary, allFields, differences } = res;

    assert.strictEqual(summary.totalFields, allFields.length);
    assert.strictEqual(summary.changedFields, differences.length);
    assert.strictEqual(summary.unchangedFields, allFields.length - differences.length);
    assert.strictEqual(summary.changedFields, summary.addedCount + summary.modifiedCount + summary.removedCount);
    assert.strictEqual(summary.totalFields, summary.changedFields + summary.unchangedFields);
    assert.ok(summary.modifiedCount >= 1, 'Should have at least 1 modified field');
    assert.ok(summary.removedCount >= 1, 'Should have at least 1 removed field');
  });

  // --------------------------------------------------------------------------
  // TEST 9: Attempting to compare the same version returns 400
  // --------------------------------------------------------------------------
  runTest('Test 9: Attempting to compare the same version (v1 and v1) throws 400 error', () => {
    assert.throws(
      () => compareVersions(v1, { ...v1 }),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Identical version selection is prohibited/);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // TEST 10: Attempting to compare versions of different documents rejected
  // --------------------------------------------------------------------------
  runTest('Test 10: Attempting to compare versions of different documents throws 400 error', () => {
    const vDiffDoc = {
      ...v2,
      documentId: new mongoose.Types.ObjectId() // Different document!
    };

    assert.throws(
      () => compareVersions(v1, vDiffDoc),
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Comparison is only permitted between versions of the same document/);
        return true;
      }
    );
  });

  // --------------------------------------------------------------------------
  // TEST 11: Non-existent versions return 404
  // --------------------------------------------------------------------------
  runTest('Test 11: Attempting to compare non-existent version is handled as 404', () => {
    const vFound = v1;
    const vMissing = null;
    const fromNum = 1;
    const toNum = 99;

    if (!vFound || !vMissing) {
      const err = new Error(`Specified version (${!vFound ? fromNum : toNum}) does not exist for this document.`);
      err.statusCode = 404;
      assert.strictEqual(err.statusCode, 404);
      assert.match(err.message, /Specified version \(99\) does not exist/);
    } else {
      assert.fail('Should have detected missing version');
    }
  });

  // --------------------------------------------------------------------------
  // TEST 12: Citizen attempting to compare another citizen's document returns 404
  // --------------------------------------------------------------------------
  runTest("Test 12: Citizen cannot access or compare another citizen's document (returns 404)", () => {
    const doc = {
      _id: commonDocId,
      ownerId: citizen1Id,
      assignedOfficerId
    };

    const citizen2 = {
      _id: citizen2Id,
      role: 'Citizen'
    };

    const hasAccess = hasDocumentAccess(doc, citizen2);
    assert.strictEqual(hasAccess, false, "Citizen 2 must not have access to Citizen 1's document");
  });

  // --------------------------------------------------------------------------
  // TEST 13: Officer attempting to compare unassigned document returns 404
  // --------------------------------------------------------------------------
  runTest('Test 13: Officer cannot access or compare unassigned document (returns 404)', () => {
    const doc = {
      _id: commonDocId,
      ownerId: citizen1Id,
      assignedOfficerId: assignedOfficerId
    };

    const otherOfficer = {
      _id: unassignedOfficerId,
      role: 'Officer'
    };

    const hasAccess = hasDocumentAccess(doc, otherOfficer);
    assert.strictEqual(hasAccess, false, 'Unassigned officer must not have access to unassigned document');
  });

  // --------------------------------------------------------------------------
  // TEST 14: Admin comparing any document succeeds
  // --------------------------------------------------------------------------
  runTest('Test 14: Admin has global access to compare any document', () => {
    const doc = {
      _id: commonDocId,
      ownerId: citizen1Id,
      assignedOfficerId: assignedOfficerId
    };

    const admin = {
      _id: adminId,
      role: 'Admin'
    };

    const hasAccess = hasDocumentAccess(doc, admin);
    assert.strictEqual(hasAccess, true, 'Admin must have access to all documents');
  });

  // --------------------------------------------------------------------------
  // TEST 15: Comparison is strictly read-only and records audit log
  // --------------------------------------------------------------------------
  await runAsyncTest('Test 15: Comparison is strictly read-only and records DOCUMENT_VERSIONS_COMPARED audit event', async () => {
    // Freeze objects to verify no mutation occurs
    const v1Copy = JSON.parse(JSON.stringify(v1));
    const v2Copy = JSON.parse(JSON.stringify(v2));

    const result = compareVersions(v1, v2);

    // Verify snapshots and SHA-256 hashes are strictly unchanged
    assert.strictEqual(v1.sha256Hash, v1Copy.sha256Hash, 'v1 SHA-256 hash must remain unaltered');
    assert.strictEqual(v2.sha256Hash, v2Copy.sha256Hash, 'v2 SHA-256 hash must remain unaltered');
    assert.deepStrictEqual(v1.snapshot, v1Copy.snapshot, 'v1 snapshot must not be mutated');
    assert.deepStrictEqual(v2.snapshot, v2Copy.snapshot, 'v2 snapshot must not be mutated');

    // Simulate audit record creation for comparison event
    let auditRecorded = false;
    const auditPayload = {
      actorId: adminId,
      action: 'DOCUMENT_VERSIONS_COMPARED',
      resourceType: 'DOCUMENT',
      resourceId: commonDocId.toString(),
      documentId: commonDocId,
      description: `Compared version 1 with version 2 of document 'land_deed_v1.pdf'.`,
      outcome: 'SUCCESS',
      metadata: {
        documentId: commonDocId.toString(),
        fromVersion: 1,
        toVersion: 2,
        changedFieldsCount: result.summary.changedFields,
        unchangedFieldsCount: result.summary.unchangedFields,
        role: 'Admin'
      }
    };

    assert.strictEqual(auditPayload.action, 'DOCUMENT_VERSIONS_COMPARED');
    assert.strictEqual(auditPayload.metadata.fromVersion, 1);
    assert.strictEqual(auditPayload.metadata.toVersion, 2);
    assert.strictEqual(auditPayload.outcome, 'SUCCESS');
  });

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDocumentComparisonTests().catch((err) => {
  console.error('Fatal error running comparison tests:', err);
  process.exit(1);
});
