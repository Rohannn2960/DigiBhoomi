const assert = require('assert');
const {
  normalizeText,
  normalizeIdentifier,
  compareLocations,
  compareParcelIdentifiers,
  compareKhataIdentifiers,
  detectDuplicates,
  detectConflicts
} = require('./detection');

console.log('--- Starting DigiBhoomi Phase 4 Unit Test Suite ---\n');

// 1. Text Normalization Test
console.log('Test 1: Normalization of text, casing, and whitespace');
assert.strictEqual(normalizeText('  RAMESH   KUMAR  '), 'ramesh kumar');
assert.strictEqual(normalizeText('Ramesh\tKumar\n'), 'ramesh kumar');
assert.strictEqual(normalizeText(null), '');
assert.strictEqual(normalizeText(undefined), '');
assert.strictEqual(normalizeText('कृषि   भूमि'), 'कृषि भूमि');
console.log('  ✓ Pass: normalizeText collapses whitespace and normalizes Unicode casing.\n');

// 2. Identifier Normalization Test
console.log('Test 2: Normalization of land identifiers (Khasra, Survey, Khata)');
assert.strictEqual(normalizeIdentifier(' 142 / 2 '), '142/2');
assert.strictEqual(normalizeIdentifier('142-B / 3'), '142-b/3');
assert.strictEqual(normalizeIdentifier('00058'), '58');
assert.strictEqual(normalizeIdentifier('00142 / 002'), '142/2');
assert.strictEqual(normalizeIdentifier(''), '');
assert.strictEqual(normalizeIdentifier(null), '');
console.log('  ✓ Pass: normalizeIdentifier strips surrounding spaces, slashes, and leading zeroes.\n');

// 3. Location Comparison Test
console.log('Test 3: Location comparison rules');
const locA = { village: { value: 'Khaspur' }, tehsil: { value: 'Sadar' }, district: { value: 'Lucknow' } };
const locB = { village: { value: ' khaspur ' }, tehsil: { value: 'SADAR' }, district: { value: 'Lucknow' } };
const locDiffVillage = { village: { value: 'Rampur' }, tehsil: { value: 'Sadar' }, district: { value: 'Lucknow' } };
const locDiffDistrict = { village: { value: 'Khaspur' }, tehsil: { value: 'Sadar' }, district: { value: 'Kanpur' } };
const locEmpty = { village: { value: '' }, tehsil: { value: '' }, district: { value: '' } };

assert.strictEqual(compareLocations(locA, locB).matches, true, 'Matching location should match');
assert.strictEqual(compareLocations(locA, locDiffVillage).matches, false, 'Differing village should not match');
assert.strictEqual(compareLocations(locA, locDiffDistrict).matches, false, 'Differing district should not match');
assert.strictEqual(compareLocations(locA, locEmpty).matches, false, 'Empty location in one should not match');
assert.strictEqual(compareLocations(locEmpty, locEmpty).matches, false, 'Both empty locations should not match');
console.log('  ✓ Pass: compareLocations requires common matching location without contradictions.\n');

// Fixtures for Duplicate and Conflict Testing
const baseDoc = {
  _id: 'doc-source-1',
  fileMetadata: {
    originalFilename: 'UP_Khasra_142.pdf',
    sha256Hash: 'hash-aaa-111'
  },
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
  }
};

// 4. Exact File Duplicate (SHA-256 Match)
console.log('Test 4: Exact duplicate detection via SHA-256 hash match');
const exactFileDup = {
  _id: 'doc-target-file-dup',
  fileMetadata: {
    originalFilename: 'Duplicate_Upload.pdf',
    sha256Hash: 'hash-aaa-111' // Identical hash
  },
  landDetails: {
    ownerName: { value: 'Different Name' },
    khasraNumber: { value: '999' }
  }
};
const dupRes1 = detectDuplicates(baseDoc, [exactFileDup]);
assert.strictEqual(dupRes1.hasPotentialDuplicates, true);
assert.strictEqual(dupRes1.duplicateCount, 1);
assert.strictEqual(dupRes1.matches[0].matchType, 'EXACT_DUPLICATE');
assert.strictEqual(dupRes1.matches[0].matchedFields.includes('fileMetadata.sha256Hash'), true);
console.log('  ✓ Pass: Exact file duplicate detected via SHA-256 hash match.\n');

// 5. Exact Land Record Duplicate (Same Parcel, Khata, Location, Owner)
console.log('Test 5: Exact land record duplicate (Parcel + Khata + Location + Owner match)');
const exactRecordDup = {
  _id: 'doc-target-exact-record',
  fileMetadata: {
    originalFilename: 'Scanned_Record_2.pdf',
    sha256Hash: 'hash-bbb-222'
  },
  landDetails: {
    ownerName: { value: '  ram charan sharma  ' }, // Case/whitespace variation
    khasraNumber: { value: ' 142 / 2 ' },         // Whitespace variation
    surveyNumber: { value: '142/2' },
    khataNumber: { value: '58' },                 // Leading zero variation (00058 vs 58)
    landArea: { value: '1.4500', unit: 'Hectare' },
    village: { value: 'khaspur' },
    tehsil: { value: 'sadar' },
    district: { value: 'lucknow' },
    landClassification: { value: 'Agricultural' }
  }
};
const dupRes2 = detectDuplicates(baseDoc, [exactRecordDup]);
assert.strictEqual(dupRes2.hasPotentialDuplicates, true);
assert.strictEqual(dupRes2.duplicateCount, 1);
assert.strictEqual(dupRes2.matches[0].matchType, 'EXACT_DUPLICATE');
assert.strictEqual(dupRes2.matches[0].matchedFields.includes('khasraNumber'), true);
assert.strictEqual(dupRes2.matches[0].matchedFields.includes('khataNumber'), true);
assert.strictEqual(dupRes2.matches[0].matchedFields.includes('ownerName'), true);
console.log('  ✓ Pass: Exact record duplicate detected with normalized values.\n');

// 6. Possible Duplicate (Same Parcel + Location + Owner, but Khata missing)
console.log('Test 6: Possible duplicate detection (Parcel + Location + Owner match, missing Khata)');
const possibleDup = {
  _id: 'doc-target-possible',
  fileMetadata: { originalFilename: 'Partial_Khatauni.pdf', sha256Hash: 'hash-ccc-333' },
  landDetails: {
    ownerName: { value: 'Ram Charan Sharma' },
    khasraNumber: { value: '142/2' },
    khataNumber: { value: '' }, // Missing Khata
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const dupRes3 = detectDuplicates(baseDoc, [possibleDup]);
assert.strictEqual(dupRes3.hasPotentialDuplicates, true);
assert.strictEqual(dupRes3.matches[0].matchType, 'POSSIBLE_DUPLICATE');
console.log('  ✓ Pass: Correctly classified as POSSIBLE_DUPLICATE when holding number is missing.\n');

// 7. Owner Match Alone is NOT a Duplicate
console.log('Test 7: Owner match alone does NOT declare records as duplicates');
const sameOwnerDiffParcel = {
  _id: 'doc-same-owner-diff-plot',
  fileMetadata: { originalFilename: 'Other_Plot.pdf', sha256Hash: 'hash-ddd-444' },
  landDetails: {
    ownerName: { value: 'Ram Charan Sharma' },
    khasraNumber: { value: '789/1' }, // Entirely different parcel
    khataNumber: { value: '999' },    // Different Khata
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const dupRes4 = detectDuplicates(baseDoc, [sameOwnerDiffParcel]);
assert.strictEqual(dupRes4.hasPotentialDuplicates, false, 'Same owner on different parcel should NOT be duplicate');
assert.strictEqual(dupRes4.duplicateCount, 0);
console.log('  ✓ Pass: Records sharing only owner name are not flagged as duplicates.\n');

// 8. Unrelated Records (Different Location and Parcel)
console.log('Test 8: Unrelated records in different villages/districts');
const unrelatedDoc = {
  _id: 'doc-unrelated',
  fileMetadata: { originalFilename: 'Jhansi_Record.pdf', sha256Hash: 'hash-eee-555' },
  landDetails: {
    ownerName: { value: 'Shiv Kumar' },
    khasraNumber: { value: '55/1' },
    khataNumber: { value: '12' },
    village: { value: 'Rampur' },
    district: { value: 'Jhansi' }
  }
};
const dupRes5 = detectDuplicates(baseDoc, [unrelatedDoc]);
const confRes5 = detectConflicts(baseDoc, [unrelatedDoc]);
assert.strictEqual(dupRes5.hasPotentialDuplicates, false);
assert.strictEqual(confRes5.hasConflicts, false);
console.log('  ✓ Pass: Unrelated records produce 0 duplicates and 0 conflicts.\n');

// 9. Self-Match Prevention
console.log('Test 9: Self-match prevention');
const selfDup = detectDuplicates(baseDoc, [baseDoc]);
const selfConf = detectConflicts(baseDoc, [baseDoc]);
assert.strictEqual(selfDup.hasPotentialDuplicates, false, 'Document cannot duplicate itself');
assert.strictEqual(selfConf.hasConflicts, false, 'Document cannot conflict with itself');
console.log('  ✓ Pass: Document compared against itself produces 0 duplicates and 0 conflicts.\n');

// 10. Missing Identifiers Handling (No False Matches on Empty Strings)
console.log('Test 10: Missing identifiers do not produce false matches');
const emptyDoc1 = {
  _id: 'doc-empty-1',
  fileMetadata: { originalFilename: 'empty1.pdf', sha256Hash: 'hash-f1' },
  landDetails: {
    ownerName: { value: '' },
    khasraNumber: { value: '' },
    khataNumber: { value: '' },
    village: { value: '' },
    district: { value: '' }
  }
};
const emptyDoc2 = {
  _id: 'doc-empty-2',
  fileMetadata: { originalFilename: 'empty2.pdf', sha256Hash: 'hash-f2' },
  landDetails: {
    ownerName: { value: '' },
    khasraNumber: { value: '' },
    khataNumber: { value: '' },
    village: { value: '' },
    district: { value: '' }
  }
};
const emptyDup = detectDuplicates(emptyDoc1, [emptyDoc2]);
const emptyConf = detectConflicts(emptyDoc1, [emptyDoc2]);
assert.strictEqual(emptyDup.hasPotentialDuplicates, false, 'Empty identifiers must not match on empty strings');
assert.strictEqual(emptyConf.hasConflicts, false, 'Empty fields must not trigger conflicts');
console.log('  ✓ Pass: Missing identifiers do not generate misleading matches.\n');

// 11. Repeated Processing Produces Consistent, Idempotent Results
console.log('Test 11: Idempotency and repeated processing consistency');
const runA = detectDuplicates(baseDoc, [exactRecordDup, possibleDup]);
const runB = detectDuplicates(baseDoc, [exactRecordDup, possibleDup]);
assert.strictEqual(runA.duplicateCount, runB.duplicateCount);
assert.strictEqual(runA.matches.length, 2);
assert.strictEqual(runB.matches.length, 2);
console.log('  ✓ Pass: Repeated detection generates consistent duplicate counts without duplicates.\n');

// 12. Cross-Record Conflict: Conflicting Owner Name on Same Parcel
console.log('Test 12: Cross-record conflict on conflicting owner names');
const conflictingOwnerDoc = {
  _id: 'doc-conflict-owner',
  fileMetadata: { originalFilename: 'Conflicting_Mutation.pdf', sha256Hash: 'hash-ggg-777' },
  landDetails: {
    ownerName: { value: 'Shyam Lal Gupta' }, // Different owner
    khasraNumber: { value: '142/2' },        // Same parcel!
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const confRes1 = detectConflicts(baseDoc, [conflictingOwnerDoc]);
assert.strictEqual(confRes1.hasConflicts, true);
assert.strictEqual(confRes1.conflictCount, 1);
assert.strictEqual(confRes1.conflicts[0].conflictingFields.some(f => f.field === 'ownerName'), true);
const ownerConflict = confRes1.conflicts[0].conflictingFields.find(f => f.field === 'ownerName');
assert.strictEqual(ownerConflict.currentValue, 'Ram Charan Sharma'); // Preserved original
assert.strictEqual(ownerConflict.targetValue, 'Shyam Lal Gupta');     // Preserved original
assert.strictEqual(ownerConflict.reason.includes('Different owner names'), true);
console.log('  ✓ Pass: Conflicting owner on same parcel detected with preserved original values.\n');

// 13. Cross-Record Conflict: Conflicting Land Area on Same Parcel
console.log('Test 13: Cross-record conflict on land area discrepancy');
const conflictingAreaDoc = {
  _id: 'doc-conflict-area',
  fileMetadata: { originalFilename: 'Resurvey_Doc.pdf', sha256Hash: 'hash-hhh-888' },
  landDetails: {
    ownerName: { value: 'Ram Charan Sharma' },
    khasraNumber: { value: '142/2' },
    landArea: { value: '2.1000', unit: 'Hectare' }, // Differs from 1.4500
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const confRes2 = detectConflicts(baseDoc, [conflictingAreaDoc]);
assert.strictEqual(confRes2.hasConflicts, true);
assert.strictEqual(confRes2.conflicts[0].conflictingFields.some(f => f.field === 'landArea'), true);
const areaConflict = confRes2.conflicts[0].conflictingFields.find(f => f.field === 'landArea');
assert.strictEqual(areaConflict.currentValue, '1.4500 Hectare');
assert.strictEqual(areaConflict.targetValue, '2.1000 Hectare');
console.log('  ✓ Pass: Differing land area on same parcel detected with original values.\n');

// 14. Normalized Case / Whitespace Differences Do NOT Trigger False Conflict
console.log('Test 14: Case and whitespace differences do NOT trigger false conflict');
const caseDiffDoc = {
  _id: 'doc-casing-diff',
  fileMetadata: { originalFilename: 'Case_Diff.pdf', sha256Hash: 'hash-iii-999' },
  landDetails: {
    ownerName: { value: '  RAM CHARAN SHARMA  ' }, // Casing/whitespace difference
    khasraNumber: { value: '142/2' },
    landArea: { value: '1.4500', unit: 'Hectare' },
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const confRes3 = detectConflicts(baseDoc, [caseDiffDoc]);
assert.strictEqual(confRes3.hasConflicts, false, 'Casing variation should normalize and NOT conflict');
console.log('  ✓ Pass: Casing and whitespace differences normalize and do not generate false conflicts.\n');

// 15. Missing Data vs Actual Mismatch (Missing Field in One Record is NOT Conflict)
console.log('Test 15: Missing field in one record is not treated as conflict');
const missingFieldDoc = {
  _id: 'doc-missing-field',
  fileMetadata: { originalFilename: 'Partial.pdf', sha256Hash: 'hash-jjj-000' },
  landDetails: {
    ownerName: { value: 'Ram Charan Sharma' },
    khasraNumber: { value: '142/2' },
    landArea: { value: '' }, // Missing area!
    village: { value: 'Khaspur' },
    district: { value: 'Lucknow' }
  }
};
const confRes4 = detectConflicts(baseDoc, [missingFieldDoc]);
assert.strictEqual(confRes4.hasConflicts, false, 'Missing field should not cause a conflict');
console.log('  ✓ Pass: Missing data is cleanly distinguished from actual mismatches.\n');

console.log('====================================================');
console.log('All 15 Detection Unit Tests Passed Successfully!');
console.log('====================================================');
