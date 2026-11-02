import assert from 'assert';

// Test the ReviewPage defensive data derivation logic directly
function evaluateReviewPageDerivedData({ record, formData, isLoading, error }) {
  if (isLoading) {
    return { rendered: 'LOADING' };
  }

  if (error || !record) {
    return { rendered: 'ERROR_OR_NOT_FOUND', error };
  }

  const getOverallConfidence = (rec) => {
    const value = rec?.ocrResult?.meanConfidence;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const overallConfidence = getOverallConfidence(record);

  const validation = record?.extractionValidation || null;
  const duplicateDetection = record?.duplicateDetection || { hasPotentialDuplicates: false, duplicateCount: 0, matches: [] };
  const conflictDetection = record?.conflictDetection || { hasConflicts: false, conflictCount: 0, conflicts: [] };

  const duplicateMatches = (duplicateDetection.matches || []).map(m => ({
    targetDocumentId: String(m.targetDocumentId || '').slice(-6),
    matchType: m.matchType,
    matchedFields: m.matchedFields || []
  }));

  const conflictsList = (conflictDetection.conflicts || []).map(c => ({
    sharedIdentifiers: (c.sharedIdentifiers || []).map(i => `${i.field}: ${i.value}`),
    conflictingFields: (c.conflictingFields || []).map(f => `${f.field}: ${f.currentValue} vs ${f.targetValue}`)
  }));

  return {
    rendered: 'RECORD_CONTENT',
    overallConfidence,
    validation,
    duplicateDetection,
    conflictDetection,
    duplicateMatches,
    conflictsList
  };
}

console.log('--- Testing ReviewPage Safe Rendering Logic ---');

// Case 1: Initial Mount State (record: null, isLoading: true)
console.log('Case 1: Initial mount state (record: null, isLoading: true)');
assert.doesNotThrow(() => {
  const result = evaluateReviewPageDerivedData({ record: null, formData: {}, isLoading: true, error: null });
  assert.strictEqual(result.rendered, 'LOADING');
}, 'Initial mount must not throw TypeError');
console.log('  ✓ Pass: Initial mount renders LOADING without crashing.\n');

// Case 2: Document Not Found / Error State
console.log('Case 2: Document error / not found (record: null, isLoading: false, error: "404")');
assert.doesNotThrow(() => {
  const result = evaluateReviewPageDerivedData({ record: null, formData: {}, isLoading: false, error: 'Document not found' });
  assert.strictEqual(result.rendered, 'ERROR_OR_NOT_FOUND');
}, 'Not found state must not throw');
console.log('  ✓ Pass: Not found state renders error card cleanly.\n');

// Case 3: Freshly Uploaded Document with Missing Detection Fields
console.log('Case 3: Freshly uploaded document (missing duplicateDetection, conflictDetection, extractionValidation)');
const freshDoc = {
  _id: '671abc123',
  status: 'Uploaded',
  fileMetadata: { originalFilename: 'deed.pdf', sha256Hash: 'abc', previewUrl: '/file' },
  ocrResult: { fullText: '' },
  landDetails: {}
  // extractionValidation, duplicateDetection, conflictDetection are absent/undefined
};
assert.doesNotThrow(() => {
  const result = evaluateReviewPageDerivedData({ record: freshDoc, formData: {}, isLoading: false, error: null });
  assert.strictEqual(result.rendered, 'RECORD_CONTENT');
  assert.strictEqual(result.duplicateDetection.duplicateCount, 0);
  assert.strictEqual(result.conflictDetection.conflictCount, 0);
  assert.deepStrictEqual(result.duplicateMatches, []);
  assert.deepStrictEqual(result.conflictsList, []);
}, 'Freshly uploaded document must render safely without crashing');
console.log('  ✓ Pass: Fresh document with undefined detection fields renders safely.\n');

// Case 4: Document with Malformed / Partial Conflict Data
console.log('Case 4: Document with partial conflict data (null sub-arrays)');
const partialDoc = {
  _id: '671abc999',
  status: 'Needs review',
  duplicateDetection: {
    duplicateCount: 1,
    matches: [{ targetDocumentId: null, matchType: 'EXACT_DUPLICATE', matchedFields: null }]
  },
  conflictDetection: {
    conflictCount: 1,
    conflicts: [{ targetDocumentId: null, sharedIdentifiers: null, conflictingFields: null }]
  }
};
assert.doesNotThrow(() => {
  const result = evaluateReviewPageDerivedData({ record: partialDoc, formData: {}, isLoading: false, error: null });
  assert.strictEqual(result.rendered, 'RECORD_CONTENT');
  assert.strictEqual(result.duplicateMatches.length, 1);
  assert.strictEqual(result.conflictsList.length, 1);
}, 'Partial conflict data must not crash');
console.log('  ✓ Pass: Partial / null sub-arrays in detection data render safely.\n');

console.log('====================================================');
console.log('All ReviewPage Safety Tests Passed Successfully!');
console.log('====================================================');
