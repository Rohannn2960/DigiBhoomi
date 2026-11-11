const assert = require('assert');
const mongoose = require('mongoose');

// Configure test environment isolation
require('./test_helpers/config');

const Document = require('./models/Document');

const {
  compareDocuments,
  normalizeText,
  normalizeUnitName,
  isValidPositiveNumericString,
  safeStringify,
  formatScalarDisplayValue,
  resolveLandAreaRepresentation,
  parseLandArea,
  convertToCanonicalAcres,
  compareLandAreas,
  extractFieldValue,
  CANONICAL_AREA_UNIT,
  ACRES_PER_HECTARE,
  GUNTAS_PER_ACRE,
  ACRES_PER_GUNTA,
  AREA_TOLERANCE_ACRES,
  SUPPORTED_AREA_UNITS,
  SEMANTIC_LAND_FIELDS,
  EXCLUDED_LAND_DETAIL_KEYS,
  METADATA_FIELDS
} = require('./services/documentComparisonService');

const { compareVersions } = require('./services/versionService');
const { calculateExtractionValidation } = require('./validation');

async function runDocumentComparisonTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Document Comparison & Score Removal Tests');
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

  // Base Sample Document for Testing
  const docA = {
    _id: new mongoose.Types.ObjectId(),
    status: 'Needs review',
    createdAt: new Date('2026-03-01T10:00:00Z'),
    fileMetadata: {
      originalFilename: 'dharani_passbook_shamshabad.png',
      sizeBytes: 245000,
      mimeType: 'image/png',
      sha256Hash: 'a'.repeat(64)
    },
    landDetails: {
      ownerName: { value: 'K. Ramachandra Reddy', confidence: 0.94 },
      surveyNumber: { value: '142/A', confidence: 0.92 },
      khataNumber: { value: 'KB-88912', confidence: 0.88 },
      landArea: { value: '2.5', unit: 'Acre', confidence: 0.90 },
      village: { value: 'Hamidullah Nagar', confidence: 0.95 },
      tehsil: { value: 'Shamshabad', confidence: 0.96 },
      district: { value: 'Rangareddy', confidence: 0.98 },
      state: { value: 'Telangana', confidence: 0.99 },
      landClassification: { value: 'Dry Agricultural', confidence: 0.85 }
    },
    accessControl: { uploadedBy: 'user-citizen-1' }
  };

  // ==========================================================================
  // SECTION 1: Aggregate Score Removal & Field-Level Confidence Retention Tests
  // ==========================================================================

  runTest('1. Field-level confidence scores are preserved on individual extracted attributes', () => {
    assert.strictEqual(docA.landDetails.ownerName.confidence, 0.94);
    assert.strictEqual(docA.landDetails.surveyNumber.confidence, 0.92);
    assert.strictEqual(docA.landDetails.landArea.confidence, 0.90);
    assert.strictEqual(docA.landDetails.district.confidence, 0.98);
  });

  runTest('2. Field-level extraction validation calculates checks without enforcing aggregate trust scores', () => {
    const val = calculateExtractionValidation(docA.landDetails, {
      fullText: 'K. Ramachandra Reddy 142/A Hamidullah Nagar Shamshabad Rangareddy'
    });
    assert(val.categories, 'Validation categories must exist');
    assert(Array.isArray(val.failedChecks), 'failedChecks array must be present');
    assert(Array.isArray(val.reviewReasons), 'reviewReasons array must be present');
    assert.strictEqual(typeof val.disclaimer, 'string', 'disclaimer must explain verification scope');
  });

  runTest('3. Comparison does not compute an aggregate trust score or score replacement', () => {
    const res = compareDocuments(docA, {
      ...docA,
      _id: new mongoose.Types.ObjectId()
    });
    assert.strictEqual(res.overallTrustScore, undefined, 'No overall trust score should exist');
    assert.strictEqual(res.confidenceScore, undefined, 'No overall confidence score should exist');
    assert.strictEqual(res.aggregateScore, undefined, 'No replacement aggregate score should exist');
  });

  // ==========================================================================
  // SECTION 2: Land-Area Unit Normalization & Tolerance Tests
  // ==========================================================================

  runTest('4. Area Normalization: Converts 1 Hectare to Acres (~2.4710538 Acres)', () => {
    const canonical = convertToCanonicalAcres(1, 'Hectare');
    assert(Math.abs(canonical - ACRES_PER_HECTARE) < 1e-6);
  });

  runTest('5. Area Normalization: Converts 40 Guntas to 1.0 Acre (1 Acre = 40 Guntas)', () => {
    const canonical = convertToCanonicalAcres(40, 'Gunta');
    assert(Math.abs(canonical - 1.0) < 1e-6);
  });

  runTest('6. Area Comparison: Equivalent areas in Acre and Gunta are detected as IDENTICAL (2.5 Acres == 100 Guntas)', () => {
    const res = compareLandAreas(
      { value: '2.5', unit: 'Acre', confidence: 0.95 },
      { value: '100', unit: 'Gunta', confidence: 0.92 }
    );
    assert.strictEqual(res.status, 'IDENTICAL');
    assert.strictEqual(res.statusLabel, 'Identical');
    assert(res.explanation.includes('numerically equivalent after unit conversion'));
    assert.strictEqual(res.docAValue, '2.5 Acre');
    assert.strictEqual(res.docBValue, '100 Gunta');
    assert.strictEqual(res.docAConfidence, 0.95);
    assert.strictEqual(res.docBConfidence, 0.92);
  });

  runTest('7. Area Comparison: Equivalent areas in Hectare and Acre are detected as IDENTICAL (1 Hectare ≈ 2.471 Acres within tolerance)', () => {
    const res = compareLandAreas(
      { value: '1.0', unit: 'Hectare' },
      { value: '2.47105', unit: 'Acre' }
    );
    assert.strictEqual(res.status, 'IDENTICAL');
    assert.strictEqual(res.statusLabel, 'Identical');
    assert(res.explanation.includes('numerically equivalent after unit conversion'));
  });

  runTest('8. Area Comparison: Genuinely different areas return DIFFERENT status with clear discrepancy note', () => {
    const res = compareLandAreas(
      { value: '2.5', unit: 'Acre' },
      { value: '3.0', unit: 'Acre' }
    );
    assert.strictEqual(res.status, 'DIFFERENT');
    assert.strictEqual(res.statusLabel, 'Different / Discrepancy');
    assert(res.explanation.includes('Land area differs'));
    assert(res.explanation.includes('Discrepancy requires review'));
  });

  runTest('9. Area Comparison: Missing unit does NOT falsely report equivalence (INCOMPARABLE / Missing Unit)', () => {
    const res = compareLandAreas(
      { value: '2.5' }, // Unit missing
      { value: '2.5', unit: 'Acre' }
    );
    assert.strictEqual(res.status, 'INCOMPARABLE');
    assert.strictEqual(res.statusLabel, 'Incomparable / Missing Unit');
    assert(res.explanation.includes('Land area unit is missing in Document A'));
    assert(res.explanation.includes('Values cannot be reliably compared'));
  });

  runTest('10. Area Comparison: Unsupported units (e.g. Bigha, Sq Yards) return INCOMPARABLE / Unsupported Unit', () => {
    const res = compareLandAreas(
      { value: '10', unit: 'Bigha' },
      { value: '10', unit: 'Acre' }
    );
    assert.strictEqual(res.status, 'INCOMPARABLE');
    assert.strictEqual(res.statusLabel, 'Incomparable / Unsupported Unit');
    assert(res.explanation.includes('Unit "Bigha" is not supported'));
  });

  runTest('11. Area Comparison: Invalid numeric values return INCOMPARABLE / Invalid Number', () => {
    const res = compareLandAreas(
      { value: 'invalid_area_value', unit: 'Acre' },
      { value: '2.5', unit: 'Acre' }
    );
    assert.strictEqual(res.status, 'INCOMPARABLE');
    assert.strictEqual(res.statusLabel, 'Incomparable / Invalid Number');
    assert(res.explanation.includes('cannot be parsed as a valid numeric extent'));
  });

  // ==========================================================================
  // SECTION 3: Separation of Land Attributes from Document Metadata
  // ==========================================================================

  runTest('12. Metadata differences (filename, upload date, file size, hash) do NOT count as land discrepancies', () => {
    // Two documents with identical land records, but totally different filenames, upload dates, hashes, and sizes
    const docA_clone = {
      ...docA,
      _id: new mongoose.Types.ObjectId()
    };
    const docB_differentMetadata = {
      _id: new mongoose.Types.ObjectId(),
      status: 'Verified', // Metadata difference
      createdAt: new Date('2026-03-08T15:45:00Z'), // Metadata difference
      fileMetadata: {
        originalFilename: 'completely_different_filename.pdf', // Metadata difference
        sizeBytes: 890000, // Metadata difference
        mimeType: 'application/pdf',
        sha256Hash: 'f'.repeat(64) // Metadata difference
      },
      assignedOfficer: 'officer-999', // Metadata difference
      landDetails: { ...docA.landDetails }, // Identical land details!
      accessControl: { uploadedBy: 'user-citizen-1' }
    };

    const res = compareDocuments(docA_clone, docB_differentMetadata);

    // Primary assertion: Land record discrepancies must be 0!
    assert.strictEqual(
      res.summary.landAttributes.discrepanciesCount,
      0,
      'Land discrepancies count must be 0 when land attributes match, despite metadata differences'
    );
    assert.strictEqual(
      res.landDiscrepancies.length,
      0,
      'landDiscrepancies list must be empty when land attributes match'
    );
    assert.strictEqual(
      res.differences.length,
      0,
      'differences must only reflect land discrepancies, not metadata'
    );

    // Metadata differences are isolated and tracked in metadataSummary
    assert(res.summary.metadata.differentCount > 0, 'Metadata differences must be tracked in metadata summary');
    assert(res.metadataDifferences.length > 0, 'metadataDifferences must list metadata variances separately');
    assert.strictEqual(
      res.metadataAttributes.length,
      METADATA_FIELDS.length,
      'Metadata attributes must be isolated in metadataAttributes array'
    );
  });

  runTest('13. Summary structure cleanly separates landAttributes summary from metadata summary', () => {
    const res = compareDocuments(docA, {
      ...docA,
      _id: new mongoose.Types.ObjectId()
    });
    assert(res.summary.landAttributes, 'summary.landAttributes must exist');
    assert(res.summary.metadata, 'summary.metadata must exist');
    assert.strictEqual(typeof res.summary.landAttributes.total, 'number');
    assert.strictEqual(typeof res.summary.landAttributes.discrepanciesCount, 'number');
    assert.strictEqual(typeof res.summary.metadata.total, 'number');
    assert.strictEqual(typeof res.summary.metadata.differentCount, 'number');
  });

  // ==========================================================================
  // SECTION 4: Custom & Unmapped Fields Tests
  // ==========================================================================

  runTest('14. Custom field present in both documents with matching value returns IDENTICAL (Custom Field)', () => {
    const docWithCustomA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        taxAssessmentNumber: { value: 'TX-2026-99' }
      }
    };
    const docWithCustomB = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        taxAssessmentNumber: { value: 'TX-2026-99' }
      }
    };

    const res = compareDocuments(docWithCustomA, docWithCustomB);
    const customAttr = res.landAttributes.find((a) => a.key === 'custom_taxAssessmentNumber');
    assert(customAttr, 'Custom attribute must be captured');
    assert.strictEqual(customAttr.status, 'IDENTICAL');
    assert.strictEqual(customAttr.statusLabel, 'Identical (Custom Field)');
    assert(customAttr.explanation.includes('matches across both documents'));
  });

  runTest('15. Custom field present in both documents with differing values returns DIFFERENT (Custom Field)', () => {
    const docWithCustomA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        taxAssessmentNumber: { value: 'TX-2026-01' }
      }
    };
    const docWithCustomB = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        taxAssessmentNumber: { value: 'TX-2026-02' }
      }
    };

    const res = compareDocuments(docWithCustomA, docWithCustomB);
    const customAttr = res.landAttributes.find((a) => a.key === 'custom_taxAssessmentNumber');
    assert(customAttr, 'Custom attribute must be captured');
    assert.strictEqual(customAttr.status, 'DIFFERENT');
    assert.strictEqual(customAttr.statusLabel, 'Different / Discrepancy (Custom Field)');
    assert(customAttr.explanation.includes('differs: Document A has'));
  });

  runTest('16. Custom field present in only one document returns MISSING_IN_A or MISSING_IN_B without false equivalence', () => {
    const docWithCustomA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        uniqueDeedStampId: { value: 'STAMP-8812' }
      }
    };
    const docStandardB = {
      ...docA,
      _id: new mongoose.Types.ObjectId()
    };

    const res = compareDocuments(docWithCustomA, docStandardB);
    const customAttr = res.landAttributes.find((a) => a.key === 'custom_uniqueDeedStampId');
    assert(customAttr, 'Custom field must be captured');
    assert.strictEqual(customAttr.status, 'MISSING_IN_B');
    assert.strictEqual(customAttr.statusLabel, 'Missing in Document B (Custom Field)');
    assert(customAttr.explanation.includes('absent in Document B schema'));

    // Inverted test
    const invRes = compareDocuments(docStandardB, docWithCustomA);
    const invAttr = invRes.landAttributes.find((a) => a.key === 'custom_uniqueDeedStampId');
    assert.strictEqual(invAttr.status, 'MISSING_IN_A');
    assert.strictEqual(invAttr.statusLabel, 'Missing in Document A (Custom Field)');
  });

  // ==========================================================================
  // SECTION 5: Safety, Immutability & Rejection Tests
  // ==========================================================================

  runTest('17. Preserves original extracted values without modifying either document (immutability)', () => {
    const origOwner = docA.landDetails.ownerName.value;
    const origArea = docA.landDetails.landArea.value;

    const otherDoc = {
      _id: new mongoose.Types.ObjectId(),
      status: 'Verified',
      fileMetadata: { originalFilename: 'other.pdf' },
      landDetails: {
        ownerName: { value: 'Different Person' },
        landArea: { value: '100', unit: 'Gunta' }
      }
    };

    compareDocuments(docA, otherDoc);

    assert.strictEqual(docA.landDetails.ownerName.value, origOwner, 'docA ownerName must be unchanged');
    assert.strictEqual(docA.landDetails.landArea.value, origArea, 'docA landArea must be unchanged');
  });

  runTest('18. Rejects identical document comparison with clear error', () => {
    assert.throws(
      () => compareDocuments(docA, docA),
      /Two distinct documents are required for comparison/
    );
  });

  runTest('19. Preserves existing version-history comparison functionality for single-document versions', () => {
    const docId = new mongoose.Types.ObjectId();
    const v1 = {
      documentId: docId,
      versionNumber: 1,
      snapshot: {
        landDetails: { ownerName: { value: 'Version 1 Owner' } },
        status: 'Needs review'
      }
    };
    const v2 = {
      documentId: docId,
      versionNumber: 2,
      snapshot: {
        landDetails: { ownerName: { value: 'Version 2 Owner' } },
        status: 'Verified'
      }
    };

    const verComparison = compareVersions(v1, v2);
    assert(verComparison.differences.length > 0, 'Version differences must be detected');
    const ownerDiff = verComparison.allFields.find((f) => f.field === 'landDetails.ownerName');
    assert.strictEqual(ownerDiff.previousValue, 'Version 1 Owner');
    assert.strictEqual(ownerDiff.updatedValue, 'Version 2 Owner');
  });

  // ==========================================================================
  // SECTION 6: Fixed Area Tolerance Tests (Small, Medium, and Large Extents)
  // ==========================================================================

  runTest('20. Fixed Tolerance: Small land extents catch genuine differences without false IDENTICAL', () => {
    // Delta = 0.001 Acre <= 0.002 tolerance => IDENTICAL
    const resIdentical = compareLandAreas(
      { value: '0.050', unit: 'Acre' },
      { value: '0.051', unit: 'Acre' }
    );
    assert.strictEqual(resIdentical.status, 'IDENTICAL');

    // Delta = 0.005 Acre > 0.002 tolerance => DIFFERENT
    const resDifferent = compareLandAreas(
      { value: '0.050', unit: 'Acre' },
      { value: '0.055', unit: 'Acre' }
    );
    assert.strictEqual(resDifferent.status, 'DIFFERENT');
    assert(resDifferent.explanation.includes('exceeds tolerance of 0.002 Acres'));
  });

  runTest('21. Fixed Tolerance: Medium land extents catch genuine differences without false IDENTICAL', () => {
    // Delta = 0.001 Acre <= 0.002 tolerance => IDENTICAL
    const resIdentical = compareLandAreas(
      { value: '10.000', unit: 'Acre' },
      { value: '10.001', unit: 'Acre' }
    );
    assert.strictEqual(resIdentical.status, 'IDENTICAL');

    // Delta = 0.025 Acre (1 Gunta) > 0.002 tolerance => DIFFERENT
    const resDifferent = compareLandAreas(
      { value: '10.000', unit: 'Acre' },
      { value: '10.025', unit: 'Acre' }
    );
    assert.strictEqual(resDifferent.status, 'DIFFERENT');
    assert(resDifferent.explanation.includes('exceeds tolerance of 0.002 Acres'));
  });

  runTest('22. Fixed Tolerance: Large land extents do NOT expand tolerance dynamically (never grows without limit)', () => {
    // Delta = 0.001 Acre <= 0.002 tolerance => IDENTICAL
    const resIdentical = compareLandAreas(
      { value: '1000.000', unit: 'Acre' },
      { value: '1000.001', unit: 'Acre' }
    );
    assert.strictEqual(resIdentical.status, 'IDENTICAL');

    // Delta = 0.500 Acre > 0.002 tolerance => DIFFERENT (under old dynamic tolerance this was falsely IDENTICAL)
    const resHalfAcreDiff = compareLandAreas(
      { value: '1000.000', unit: 'Acre' },
      { value: '1000.500', unit: 'Acre' }
    );
    assert.strictEqual(resHalfAcreDiff.status, 'DIFFERENT');
    assert(resHalfAcreDiff.explanation.includes('exceeds tolerance of 0.002 Acres'));

    // Delta = 1.000 Acre > 0.002 tolerance => DIFFERENT
    const resOneAcreDiff = compareLandAreas(
      { value: '1000.000', unit: 'Acre' },
      { value: '1001.000', unit: 'Acre' }
    );
    assert.strictEqual(resOneAcreDiff.status, 'DIFFERENT');
  });

  // ==========================================================================
  // SECTION 7: Hardened Land-Area Parsing Tests
  // ==========================================================================

  runTest('23. Hardened Parsing: Rejects negative land areas as INCOMPARABLE', () => {
    const resObj = compareLandAreas(
      { value: -5, unit: 'Acre' },
      { value: '5.0', unit: 'Acre' }
    );
    assert.strictEqual(resObj.status, 'INCOMPARABLE');
    assert.strictEqual(resObj.statusLabel, 'Incomparable / Negative Value');
    assert(resObj.explanation.includes('is negative'));

    const resStr = compareLandAreas(
      { value: '-2.5 Acre' },
      { value: '2.5 Acre' }
    );
    assert.strictEqual(resStr.status, 'INCOMPARABLE');
    assert.strictEqual(resStr.statusLabel, 'Incomparable / Negative Value');
  });

  runTest('24. Hardened Parsing: Handles valid decimal forms such as .5 Acre', () => {
    const parsedDot5 = parseLandArea('.5 Acre');
    assert.strictEqual(parsedDot5.numeric, 0.5);
    assert.strictEqual(parsedDot5.unit, 'Acre');
    assert.strictEqual(parsedDot5.error, null);

    // .5 Acre == 20 Guntas (0.5 * 40 = 20)
    const res = compareLandAreas('.5 Acre', '20 Gunta');
    assert.strictEqual(res.status, 'IDENTICAL');
    assert(res.explanation.includes('numerically equivalent after unit conversion'));
  });

  runTest('25. Hardened Parsing: Handles comma-separated numbers safely (standard & Indian numbering) and rejects malformed commas', () => {
    const parsed1250 = parseLandArea('1,250 Acres');
    assert.strictEqual(parsed1250.numeric, 1250);
    assert.strictEqual(parsed1250.unit, 'Acre');

    const parsedIndian = parseLandArea('1,00,000 Acres');
    assert.strictEqual(parsedIndian.numeric, 100000);
    assert.strictEqual(parsedIndian.unit, 'Acre');

    // Malformed comma formats must be rejected as invalid_numeric
    const malformed1 = parseLandArea('1,2,50 Acres');
    assert.strictEqual(malformed1.error, 'invalid_numeric');

    const malformed2 = parseLandArea('1,,250 Acres');
    assert.strictEqual(malformed2.error, 'invalid_numeric');

    const malformed3 = parseLandArea(',250 Acres');
    assert.strictEqual(malformed3.error, 'invalid_numeric');
  });

  runTest('26. Hardened Parsing: Rejects partially numeric strings without silent acceptance', () => {
    const resPart1 = compareLandAreas('2.5foo Acre', '2.5 Acre');
    assert.strictEqual(resPart1.status, 'INCOMPARABLE');
    assert.strictEqual(resPart1.statusLabel, 'Incomparable / Invalid Number');

    const resPart2 = compareLandAreas('12abc34', '12 Acre');
    assert.strictEqual(resPart2.status, 'INCOMPARABLE');
    assert.strictEqual(resPart2.statusLabel, 'Incomparable / Invalid Number');

    const resPart3 = compareLandAreas('2.5.5 Acre', '2.5 Acre');
    assert.strictEqual(resPart3.status, 'INCOMPARABLE');
    assert.strictEqual(resPart3.statusLabel, 'Incomparable / Invalid Number');

    const resPart4 = compareLandAreas('2.5-3.0 Acres', '2.5 Acre');
    assert.strictEqual(resPart4.status, 'INCOMPARABLE');
    assert.strictEqual(resPart4.statusLabel, 'Incomparable / Invalid Number');
  });

  runTest('27. Hardened Parsing: Conflicting embedded and explicit property units return INCOMPARABLE with clear explanation', () => {
    const resConflict = compareLandAreas(
      { value: '2.5 Acre', unit: 'Gunta' },
      { value: '2.5', unit: 'Acre' }
    );
    assert.strictEqual(resConflict.status, 'INCOMPARABLE');
    assert.strictEqual(resConflict.statusLabel, 'Incomparable / Conflicting Units');
    assert(resConflict.explanation.includes('conflicting units'));
    assert(resConflict.explanation.includes('embedded "Acre" vs property "Gunta"'));

    const resConflict2 = compareLandAreas(
      { value: '1.0 Hectare', unit: 'Acre' },
      { value: '1.0', unit: 'Hectare' }
    );
    assert.strictEqual(resConflict2.status, 'INCOMPARABLE');
    assert.strictEqual(resConflict2.statusLabel, 'Incomparable / Conflicting Units');
  });

  runTest('28. Hardened Parsing: Agreeing embedded and explicit property units succeed normally', () => {
    const resAgree = compareLandAreas(
      { value: '2.5 Acres', unit: 'acre' },
      { value: '2.5', unit: 'Acre' }
    );
    assert.strictEqual(resAgree.status, 'IDENTICAL');

    const resAgree2 = compareLandAreas(
      { value: '100 Guntas', unit: 'gunta' },
      { value: '2.5', unit: 'Acre' }
    );
    assert.strictEqual(resAgree2.status, 'IDENTICAL');
  });

  // ==========================================================================
  // SECTION 8: Custom Structured Fields Tests
  // ==========================================================================

  runTest('29. Custom Fields: Handles primitives (string, number, boolean) and nested { value } objects', () => {
    const docCust1 = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        customString: 'Sub-Plot-7A',
        customNumber: 42,
        customBool: true,
        customNested: { value: 'NestedVal-1', confidence: 0.96 }
      }
    };
    const docCust2 = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        customString: 'Sub-Plot-7A',
        customNumber: 42,
        customBool: true,
        customNested: { value: 'NestedVal-1', confidence: 0.94 }
      }
    };

    const res = compareDocuments(docCust1, docCust2);
    const attrStr = res.landAttributes.find((a) => a.key === 'custom_customString');
    const attrNum = res.landAttributes.find((a) => a.key === 'custom_customNumber');
    const attrBool = res.landAttributes.find((a) => a.key === 'custom_customBool');
    const attrNested = res.landAttributes.find((a) => a.key === 'custom_customNested');

    assert.strictEqual(attrStr.status, 'IDENTICAL');
    assert.strictEqual(attrNum.status, 'IDENTICAL');
    assert.strictEqual(attrBool.status, 'IDENTICAL');
    assert.strictEqual(attrNested.status, 'IDENTICAL');
    assert.strictEqual(attrNested.docAConfidence, 0.96);
    assert.strictEqual(attrNested.docBConfidence, 0.94);
  });

  runTest('30. Custom Fields: Array custom fields are marked INCOMPARABLE without silently displaying as absent', () => {
    const docArrayA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        subDivisions: ['142/A', '142/B', '142/C']
      }
    };
    const docArrayB = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        subDivisions: ['142/A', '142/B']
      }
    };

    const res = compareDocuments(docArrayA, docArrayB);
    const subDivAttr = res.landAttributes.find((a) => a.key === 'custom_subDivisions');
    assert(subDivAttr, 'Custom array field must be captured');
    assert.strictEqual(subDivAttr.status, 'INCOMPARABLE');
    assert.strictEqual(subDivAttr.statusLabel, 'Incomparable / Complex Structure');
    assert.strictEqual(subDivAttr.docAValue, '["142/A","142/B","142/C"]');
    assert.strictEqual(subDivAttr.docBValue, '["142/A","142/B"]');
    assert(subDivAttr.explanation.includes('unsupported complex structure'));
    assert(res.summary.landAttributes.incomparableCount > 0);
  });

  runTest('31. Custom Fields: Complex objects without scalar representation are marked INCOMPARABLE and not silently absent', () => {
    const docObjA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        geoCoordinates: { latitude: 17.385, longitude: 78.486 }
      }
    };
    const docObjB = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails
        // geoCoordinates is absent in docObjB
      }
    };

    const res = compareDocuments(docObjA, docObjB);
    const geoAttr = res.landAttributes.find((a) => a.key === 'custom_geoCoordinates');
    assert(geoAttr, 'Complex object custom field must be captured');
    assert.strictEqual(geoAttr.status, 'INCOMPARABLE');
    assert.strictEqual(geoAttr.statusLabel, 'Incomparable / Complex Structure');
    assert.strictEqual(geoAttr.docAValue, '{"latitude":17.385,"longitude":78.486}');
    assert.strictEqual(geoAttr.docBValue, '(Absent)');
    assert(geoAttr.explanation.includes('Document A contains an unsupported complex structure'));
  });

  runTest('32. Custom Fields: Preserves original source values and does not mutate documents with complex structures', () => {
    const rawCoords = { latitude: 17.385, longitude: 78.486 };
    const rawArr = ['142/A', '142/B'];
    const docWithStructA = {
      _id: new mongoose.Types.ObjectId(),
      status: 'Needs review',
      landDetails: {
        ownerName: { value: 'Original Owner' },
        geoCoordinates: rawCoords,
        subDivisions: rawArr
      }
    };
    const docWithStructB = {
      _id: new mongoose.Types.ObjectId(),
      status: 'Verified',
      landDetails: {
        ownerName: { value: 'Original Owner' }
      }
    };

    compareDocuments(docWithStructA, docWithStructB);

    // Verify source documents are completely unmutated
    assert.deepStrictEqual(docWithStructA.landDetails.geoCoordinates, rawCoords);
    assert.deepStrictEqual(docWithStructA.landDetails.subDivisions, rawArr);
    assert.strictEqual(docWithStructA.landDetails.geoCoordinates.latitude, 17.385);
    assert.strictEqual(docWithStructA.landDetails.subDivisions.length, 2);
  });

  // ==========================================================================
  // SECTION 9: Land-Area Source Resolution & Regression Tests
  // ==========================================================================

  runTest('33. Area Source Resolution: Empty/default landArea does not mask populated area.value and areaUnit.value', () => {
    const docEmptyLandAreaPopulatedArea = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '', unit: 'Acre' }, // Mongoose schema default
        area: { value: '2.5', confidence: 0.93 },
        areaUnit: { value: 'Acre', confidence: 0.95 }
      }
    };
    const docWithGunta = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '100', unit: 'Gunta', confidence: 0.91 }
      }
    };

    const resolved = resolveLandAreaRepresentation(docEmptyLandAreaPopulatedArea.landDetails);
    assert(resolved !== null, 'Resolved area representation must not be null');
    assert.strictEqual(resolved.value, '2.5');
    assert.strictEqual(resolved.unit, 'Acre');
    assert.strictEqual(resolved.confidence, 0.93);

    // In comparison, 2.5 Acre vs 100 Gunta must be detected as IDENTICAL
    const res = compareDocuments(docEmptyLandAreaPopulatedArea, docWithGunta);
    const areaAttr = res.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttr, 'landArea attribute must be present in comparison');
    assert.strictEqual(areaAttr.status, 'IDENTICAL');
    assert.strictEqual(areaAttr.docAValue, '2.5 Acre');
    assert.strictEqual(areaAttr.docBValue, '100 Gunta');
    assert.strictEqual(areaAttr.docAConfidence, 0.93);
    assert.strictEqual(areaAttr.docBConfidence, 0.91);
  });

  runTest('34. Area Source Resolution: Populated canonical landArea takes precedence over area', () => {
    const docBothPopulated = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '10', unit: 'Hectare', confidence: 0.96 },
        area: { value: '2.5', confidence: 0.50 },
        areaUnit: { value: 'Acre', confidence: 0.50 }
      }
    };

    const resolved = resolveLandAreaRepresentation(docBothPopulated.landDetails);
    assert(resolved !== null);
    assert.strictEqual(resolved.value, '10');
    assert.strictEqual(resolved.unit, 'Hectare');
    assert.strictEqual(resolved.confidence, 0.96);

    const docTargetHectare = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '10', unit: 'Hectare' }
      }
    };

    const res = compareDocuments(docBothPopulated, docTargetHectare);
    const areaAttr = res.landAttributes.find((a) => a.key === 'landArea');
    assert.strictEqual(areaAttr.status, 'IDENTICAL');
    assert.strictEqual(areaAttr.docAValue, '10 Hectare');
  });

  runTest('35. Area Source Resolution: Legacy extent fallback when both landArea and area are empty', () => {
    const docLegacyExtent = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '' },
        extent: { value: '40 Gunta', confidence: 0.88 }
      }
    };

    const resolved = resolveLandAreaRepresentation(docLegacyExtent.landDetails);
    assert(resolved !== null);
    assert.strictEqual(resolved.value, '40 Gunta');
    assert.strictEqual(resolved.confidence, 0.88);

    const docOneAcre = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '1.0', unit: 'Acre' }
      }
    };

    // 40 Gunta == 1.0 Acre
    const res = compareDocuments(docLegacyExtent, docOneAcre);
    const areaAttr = res.landAttributes.find((a) => a.key === 'landArea');
    assert.strictEqual(areaAttr.status, 'IDENTICAL');
    assert.strictEqual(areaAttr.docAValue, '40 Gunta');
    assert.strictEqual(areaAttr.docBValue, '1.0 Acre');
  });

  runTest('36. Area Source Resolution: Missing areaUnit does NOT silently assume Acre for separate area representation', () => {
    const docAreaNoUnit = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5' } // areaUnit is missing!
      }
    };

    const resolved = resolveLandAreaRepresentation(docAreaNoUnit.landDetails);
    assert(resolved !== null);
    assert.strictEqual(resolved.value, '2.5');
    assert.strictEqual(resolved.unit, null, 'Unit must be null when areaUnit is missing; do NOT assume Acre');

    const docWithAcre = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '2.5', unit: 'Acre' }
      }
    };

    const res = compareDocuments(docAreaNoUnit, docWithAcre);
    const areaAttr = res.landAttributes.find((a) => a.key === 'landArea');
    assert.strictEqual(areaAttr.status, 'INCOMPARABLE');
    assert.strictEqual(areaAttr.statusLabel, 'Incomparable / Missing Unit');
    assert(areaAttr.explanation.includes('Land area unit is missing in Document A'));
  });

  runTest('37. Area Source Resolution: Conflicting embedded and explicit units in area/areaUnit still return INCOMPARABLE', () => {
    const docConflict = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5 Gunta' }, // embedded Gunta
        areaUnit: { value: 'Acre' }    // explicit Acre
      }
    };
    const docNormal = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '2.5', unit: 'Acre' }
      }
    };

    const res = compareDocuments(docConflict, docNormal);
    const areaAttr = res.landAttributes.find((a) => a.key === 'landArea');
    assert.strictEqual(areaAttr.status, 'INCOMPARABLE');
    assert.strictEqual(areaAttr.statusLabel, 'Incomparable / Conflicting Units');
    assert(areaAttr.explanation.includes('conflicting units'));
  });

  runTest('38. Custom Fields: areaUnit is consumed by resolver and NEVER appears as custom_areaUnit', () => {
    const docWithAreaUnit = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        area: { value: '5.0' },
        areaUnit: { value: 'Acre' },
        actualCustomField: { value: 'CustomCadastralVal' }
      }
    };
    const docOther = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        actualCustomField: { value: 'CustomCadastralVal' }
      }
    };

    const res = compareDocuments(docWithAreaUnit, docOther);

    // areaUnit must never appear as a custom field
    const customAreaUnitAttr = res.landAttributes.find((a) => a.key === 'custom_areaUnit');
    assert.strictEqual(customAreaUnitAttr, undefined, 'areaUnit must NOT appear as custom_areaUnit');

    const allAreaUnitAttr = res.allAttributes.find((a) => a.key === 'custom_areaUnit');
    assert.strictEqual(allAreaUnitAttr, undefined, 'areaUnit must NOT appear anywhere as custom_areaUnit');

    // Genuine custom field must be captured
    const customAttr = res.landAttributes.find((a) => a.key === 'custom_actualCustomField');
    assert(customAttr, 'Genuine custom fields must be captured');
    assert.strictEqual(customAttr.status, 'IDENTICAL');
  });

  runTest('39. Zero Area Rejection: Zero numeric, string, and decimal land areas return INCOMPARABLE (not missing)', () => {
    const zeroTestCases = [
      { value: 0, unit: 'Acre' },
      { value: '0', unit: 'Acre' },
      { value: '0.0', unit: 'Acre' },
      '0 Acre',
      '0.00 Hectare',
      0
    ];

    for (const zeroCase of zeroTestCases) {
      const parsed = parseLandArea(zeroCase);
      assert.strictEqual(parsed.error, 'zero_area', `zeroCase should produce zero_area error: ${JSON.stringify(zeroCase)}`);
      assert.strictEqual(parsed.numeric, 0);

      const res = compareLandAreas(zeroCase, { value: '2.5', unit: 'Acre' });
      assert.strictEqual(res.status, 'INCOMPARABLE', `Zero area must return INCOMPARABLE: ${JSON.stringify(zeroCase)}`);
      assert.strictEqual(res.statusLabel, 'Incomparable / Non-Positive Area');
      assert.notStrictEqual(res.status, 'MISSING_IN_A', 'Zero area must not be classified as missing');
      assert(res.explanation.includes('is zero'));
    }
  });

  runTest('40. Positive Decimals: Valid positive decimals like .5 Acre and .05 Acre compare accurately', () => {
    // .5 Acre == 20 Gunta
    const resHalfAcre = compareLandAreas('.5 Acre', '20 Gunta');
    assert.strictEqual(resHalfAcre.status, 'IDENTICAL');
    assert(resHalfAcre.explanation.includes('numerically equivalent after unit conversion'));

    // .05 Acre == 2 Gunta (0.05 * 40 = 2)
    const resPoint05 = compareLandAreas('.05 Acre', '2 Gunta');
    assert.strictEqual(resPoint05.status, 'IDENTICAL');

    // .5 Acre vs 21 Gunta (21 Gunta = 0.525 Acres, delta = 0.025 > 0.002) => DIFFERENT
    const resDiff = compareLandAreas('.5 Acre', '21 Gunta');
    assert.strictEqual(resDiff.status, 'DIFFERENT');
  });

  runTest('41. Scalar Display Values: Numeric zero and boolean false are displayed properly in standard fields', () => {
    const docWithScalarsA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        surveyNumber: { value: 0 },
        khataNumber: { value: false }
      }
    };
    const docWithScalarsB = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        surveyNumber: { value: '0' },
        khataNumber: { value: false }
      }
    };

    const res = compareDocuments(docWithScalarsA, docWithScalarsB);
    const surveyAttr = res.landAttributes.find((a) => a.key === 'surveyNumber');
    const khataAttr = res.landAttributes.find((a) => a.key === 'khataNumber');

    // SurveyNumber 0 vs '0'
    assert.strictEqual(surveyAttr.status, 'IDENTICAL');
    assert.strictEqual(surveyAttr.docAValue, '0', 'Numeric 0 must be displayed as "0", not fallback');
    assert.strictEqual(surveyAttr.docBValue, '0', 'String "0" must be displayed as "0", not fallback');

    // KhataNumber false vs false
    assert.strictEqual(khataAttr.status, 'IDENTICAL');
    assert.strictEqual(khataAttr.docAValue, 'false', 'Boolean false must be displayed as "false", not fallback');
    assert.strictEqual(khataAttr.docBValue, 'false', 'Boolean false must be displayed as "false", not fallback');

    // Now test against missing/empty
    const docEmptyScalars = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        surveyNumber: { value: '' },
        khataNumber: null
      }
    };

    const resMissing = compareDocuments(docWithScalarsA, docEmptyScalars);
    const surveyMissing = resMissing.landAttributes.find((a) => a.key === 'surveyNumber');
    assert.strictEqual(surveyMissing.status, 'MISSING_IN_B');
    assert.strictEqual(surveyMissing.docAValue, '0', 'Numeric 0 must be displayed as "0" in MISSING_IN_B');
    assert.strictEqual(surveyMissing.docBValue, '(Not provided)', 'Empty value must display fallback');
  });

  runTest('42. Metadata Protection: Invalid createdAt date string does NOT throw and returns unavailable/null', () => {
    const docInvalidDate = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      createdAt: 'invalid-date-format-string-that-throws'
    };
    const docNormal = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date('2026-03-01T10:00:00Z')
    };

    // Must not throw RangeError: Invalid time value
    let res;
    assert.doesNotThrow(() => {
      res = compareDocuments(docInvalidDate, docNormal);
    }, 'compareDocuments must never crash on malformed createdAt metadata');

    assert(res, 'Comparison result must be returned');
    const uploadDateAttr = res.metadataAttributes.find((a) => a.key === 'uploadDate');
    assert(uploadDateAttr, 'uploadDate metadata attribute must be present');
    assert.strictEqual(uploadDateAttr.docAValue, '(Not available)');
    assert.strictEqual(uploadDateAttr.status, 'MISSING_IN_A');

    // Also test with NaN or object
    const docNaN = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      createdAt: NaN
    };
    assert.doesNotThrow(() => {
      compareDocuments(docNaN, docNormal);
    });
  });

  runTest('43. Area Source Resolution: Harmonization and conflict detection between area.unit and areaUnit.value', () => {
    // 1. area.unit = Acre, areaUnit.value = Gunta -> INCOMPARABLE / Conflicting Units
    const docConflictUnits = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5', unit: 'Acre', confidence: 0.95 },
        areaUnit: { value: 'Gunta', confidence: 0.90 }
      }
    };

    const resolvedConflict = resolveLandAreaRepresentation(docConflictUnits.landDetails);
    assert(resolvedConflict !== null, 'Resolved representation must not be null');
    assert.strictEqual(resolvedConflict.value, '2.5');
    assert.strictEqual(resolvedConflict.unit, null);
    assert.strictEqual(resolvedConflict.areaUnit, 'Acre');
    assert.strictEqual(resolvedConflict.explicitUnit, 'Gunta');
    assert.strictEqual(resolvedConflict.error, 'conflicting_units');
    assert(resolvedConflict.conflictDetails.includes('area.unit "Acre" vs areaUnit.value "Gunta"'));

    const docTargetAcre = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '2.5', unit: 'Acre' }
      }
    };

    const resConflict = compareDocuments(docConflictUnits, docTargetAcre);
    const areaAttrConflict = resConflict.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrConflict);
    assert.strictEqual(areaAttrConflict.status, 'INCOMPARABLE');
    assert.strictEqual(areaAttrConflict.statusLabel, 'Incomparable / Conflicting Units');
    assert(areaAttrConflict.explanation.includes('conflicting units'));
    assert(areaAttrConflict.explanation.includes('area.unit "Acre" vs areaUnit.value "Gunta"'));

    // Immutability check: source document fields were not mutated
    assert.deepStrictEqual(docConflictUnits.landDetails.area, { value: '2.5', unit: 'Acre', confidence: 0.95 });
    assert.deepStrictEqual(docConflictUnits.landDetails.areaUnit, { value: 'Gunta', confidence: 0.90 });

    // Also direct compareLandAreas call on resolved conflict representation
    const resDirectConflict = compareLandAreas(resolvedConflict, { value: '2.5', unit: 'Acre' });
    assert.strictEqual(resDirectConflict.status, 'INCOMPARABLE');
    assert.strictEqual(resDirectConflict.statusLabel, 'Incomparable / Conflicting Units');

    // 2. Both units agree -> normal comparison
    const docAgreeUnits = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5', unit: 'Acre', confidence: 0.95 },
        areaUnit: { value: 'acres', confidence: 0.90 } // normalized to Acre
      }
    };
    const resolvedAgree = resolveLandAreaRepresentation(docAgreeUnits.landDetails);
    assert(resolvedAgree !== null);
    assert.strictEqual(resolvedAgree.value, '2.5');
    assert.strictEqual(resolvedAgree.unit, 'Acre');
    assert.strictEqual(resolvedAgree.areaUnit, 'Acre');
    assert.strictEqual(resolvedAgree.explicitUnit, 'Acre');
    assert.strictEqual(resolvedAgree.error, undefined);

    const docTargetGunta100 = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '100', unit: 'Gunta' }
      }
    };

    // 2.5 Acre == 100 Gunta -> IDENTICAL
    const resAgree = compareDocuments(docAgreeUnits, docTargetGunta100);
    const areaAttrAgree = resAgree.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrAgree);
    assert.strictEqual(areaAttrAgree.status, 'IDENTICAL');
    assert.strictEqual(areaAttrAgree.docAValue, '2.5 Acre');
    assert.strictEqual(areaAttrAgree.docBValue, '100 Gunta');

    // 3. Only area.unit populated -> use it
    const docOnlyAreaUnit = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5', unit: 'Acre', confidence: 0.94 }
        // areaUnit is omitted / undefined
      }
    };
    const resolvedOnlyAreaUnit = resolveLandAreaRepresentation(docOnlyAreaUnit.landDetails);
    assert(resolvedOnlyAreaUnit !== null);
    assert.strictEqual(resolvedOnlyAreaUnit.value, '2.5');
    assert.strictEqual(resolvedOnlyAreaUnit.unit, 'Acre');
    assert.strictEqual(resolvedOnlyAreaUnit.areaUnit, 'Acre');
    assert.strictEqual(resolvedOnlyAreaUnit.explicitUnit, null);

    const resOnlyAreaUnit = compareDocuments(docOnlyAreaUnit, docTargetGunta100);
    const areaAttrOnlyAreaUnit = resOnlyAreaUnit.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrOnlyAreaUnit);
    assert.strictEqual(areaAttrOnlyAreaUnit.status, 'IDENTICAL');
    assert.strictEqual(areaAttrOnlyAreaUnit.docAValue, '2.5 Acre');

    // 4. Only areaUnit.value populated -> use it
    const docOnlyExplicitUnit = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '100' }, // unit omitted
        areaUnit: { value: 'Gunta', confidence: 0.89 }
      }
    };
    const resolvedOnlyExplicitUnit = resolveLandAreaRepresentation(docOnlyExplicitUnit.landDetails);
    assert(resolvedOnlyExplicitUnit !== null);
    assert.strictEqual(resolvedOnlyExplicitUnit.value, '100');
    assert.strictEqual(resolvedOnlyExplicitUnit.unit, 'Gunta');
    assert.strictEqual(resolvedOnlyExplicitUnit.areaUnit, null);
    assert.strictEqual(resolvedOnlyExplicitUnit.explicitUnit, 'Gunta');

    const resOnlyExplicitUnit = compareDocuments(docOnlyExplicitUnit, docTargetAcre);
    const areaAttrOnlyExplicitUnit = resOnlyExplicitUnit.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrOnlyExplicitUnit);
    assert.strictEqual(areaAttrOnlyExplicitUnit.status, 'IDENTICAL');
    assert.strictEqual(areaAttrOnlyExplicitUnit.docAValue, '100 Gunta');
    assert.strictEqual(areaAttrOnlyExplicitUnit.docBValue, '2.5 Acre');

    // 5. Neither populated -> INCOMPARABLE / Missing Unit
    const docNeitherUnit = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        landArea: { value: '' },
        area: { value: '2.5' } // neither unit nor areaUnit
      }
    };
    const resolvedNeitherUnit = resolveLandAreaRepresentation(docNeitherUnit.landDetails);
    assert(resolvedNeitherUnit !== null);
    assert.strictEqual(resolvedNeitherUnit.value, '2.5');
    assert.strictEqual(resolvedNeitherUnit.unit, null, 'Unit must not default to Acre');
    assert.strictEqual(resolvedNeitherUnit.areaUnit, null);
    assert.strictEqual(resolvedNeitherUnit.explicitUnit, null);

    const resNeitherUnit = compareDocuments(docNeitherUnit, docTargetAcre);
    const areaAttrNeitherUnit = resNeitherUnit.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrNeitherUnit);
    assert.strictEqual(areaAttrNeitherUnit.status, 'INCOMPARABLE');
    assert.strictEqual(areaAttrNeitherUnit.statusLabel, 'Incomparable / Missing Unit');
    assert(areaAttrNeitherUnit.explanation.includes('Land area unit is missing in Document A'));
  });

  runTest('44. Mongoose Document Model Instances: Schema defaults, resolution, conflict detection, and subdocument comparison', () => {
    // 1. Create a Mongoose Document with:
    //    - landDetails.landArea.value = '' (schema default unit is Acre)
    //    - landDetails.area.value = '2.5'
    //    - landDetails.area.unit absent
    //    - landDetails.areaUnit.value = 'Gunta'
    //    Verify the resolver selects area.value and areaUnit.value, not the empty canonical landArea default.
    const mongooseDoc1 = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_doc_1.pdf',
        storedFilename: 'mongoose_doc_1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 154000,
        sha256Hash: '1'.repeat(64),
        storagePath: '/tmp/mongoose_doc_1.pdf'
      },
      landDetails: {
        landArea: { value: '' }, // unit defaults to 'Acre' in Document schema
        area: { value: '2.5' },  // unit is absent
        areaUnit: { value: 'Gunta' }
      }
    });

    // Check schema defaults on the Mongoose instance
    assert.strictEqual(mongooseDoc1.landDetails.landArea.value, '');
    assert.strictEqual(mongooseDoc1.landDetails.landArea.unit, 'Acre', 'Schema default for landArea.unit must be Acre');
    assert.strictEqual(mongooseDoc1.landDetails.area.value, '2.5');
    assert.strictEqual(mongooseDoc1.landDetails.area.unit, undefined, 'area.unit must be absent');
    assert.strictEqual(mongooseDoc1.landDetails.areaUnit.value, 'Gunta');

    const resolved1 = resolveLandAreaRepresentation(mongooseDoc1.landDetails);
    assert(resolved1 !== null, 'Resolver must return resolved object');
    assert.strictEqual(resolved1.value, '2.5', 'Must select area.value, not empty landArea');
    assert.strictEqual(resolved1.unit, 'Gunta', 'Must select areaUnit.value (Gunta), not default landArea unit (Acre)');
    assert.strictEqual(resolved1.areaUnit, null);
    assert.strictEqual(resolved1.explicitUnit, 'Gunta');

    // 2. Create another Mongoose Document with:
    //    - empty landArea.value
    //    - area.value = '2.5'
    //    - area.unit = 'Acre'
    //    - areaUnit.value = 'Gunta'
    //    Verify comparison returns INCOMPARABLE / Conflicting Units.
    const mongooseDoc2 = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_doc_2.pdf',
        storedFilename: 'mongoose_doc_2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 162000,
        sha256Hash: '2'.repeat(64),
        storagePath: '/tmp/mongoose_doc_2.pdf'
      },
      landDetails: {
        landArea: { value: '' }, // unit defaults to 'Acre' in Document schema
        area: { value: '2.5', unit: 'Acre' },
        areaUnit: { value: 'Gunta' }
      }
    });

    const targetDocAcre = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_target_acre.pdf',
        storedFilename: 'mongoose_target_acre.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 140000,
        sha256Hash: '3'.repeat(64),
        storagePath: '/tmp/mongoose_target_acre.pdf'
      },
      landDetails: {
        landArea: { value: '2.5', unit: 'Acre' }
      }
    });

    const resConflict = compareDocuments(mongooseDoc2, targetDocAcre);
    const areaAttrConflict = resConflict.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrConflict);
    assert.strictEqual(areaAttrConflict.status, 'INCOMPARABLE');
    assert.strictEqual(areaAttrConflict.statusLabel, 'Incomparable / Conflicting Units');
    assert(areaAttrConflict.explanation.includes('conflicting units'));
    assert(areaAttrConflict.explanation.includes('area.unit "Acre" vs areaUnit.value "Gunta"'));

    // 3. Verify that the Mongoose document's original nested values remain unchanged after comparison.
    assert.strictEqual(mongooseDoc2.landDetails.landArea.value, '');
    assert.strictEqual(mongooseDoc2.landDetails.landArea.unit, 'Acre');
    assert.strictEqual(mongooseDoc2.landDetails.area.value, '2.5');
    assert.strictEqual(mongooseDoc2.landDetails.area.unit, 'Acre');
    assert.strictEqual(mongooseDoc2.landDetails.areaUnit.value, 'Gunta');

    assert.strictEqual(targetDocAcre.landDetails.landArea.value, '2.5');
    assert.strictEqual(targetDocAcre.landDetails.landArea.unit, 'Acre');

    // 4. Verify matching units on actual Mongoose subdocuments compare normally.
    // Case 4A: Equivalent converted units (2.5 Acre via area + areaUnit vs 100 Gunta on landArea)
    const targetDocGunta100 = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_target_100gunta.pdf',
        storedFilename: 'mongoose_target_100gunta.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 145000,
        sha256Hash: '4'.repeat(64),
        storagePath: '/tmp/mongoose_target_100gunta.pdf'
      },
      landDetails: {
        landArea: { value: '100', unit: 'Gunta' }
      }
    });

    const mongooseDocAgreeAcre = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_doc_agree.pdf',
        storedFilename: 'mongoose_doc_agree.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 150000,
        sha256Hash: '5'.repeat(64),
        storagePath: '/tmp/mongoose_doc_agree.pdf'
      },
      landDetails: {
        landArea: { value: '' },
        area: { value: '2.5', unit: 'Acre' },
        areaUnit: { value: 'Acre' }
      }
    });

    const resAgree = compareDocuments(mongooseDocAgreeAcre, targetDocGunta100);
    const areaAttrAgree = resAgree.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrAgree);
    assert.strictEqual(areaAttrAgree.status, 'IDENTICAL');
    assert.strictEqual(areaAttrAgree.docAValue, '2.5 Acre');
    assert.strictEqual(areaAttrAgree.docBValue, '100 Gunta');
    assert(areaAttrAgree.explanation.includes('numerically equivalent after unit conversion'));

    // Case 4B: Equivalent converted units (2.5 Gunta from doc1 vs 0.0625 Acre)
    // 2.5 Gunta = 2.5 / 40 = 0.0625 Acre
    const targetDocAcrePoint0625 = new Document({
      fileMetadata: {
        originalFilename: 'mongoose_target_point0625.pdf',
        storedFilename: 'mongoose_target_point0625.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 148000,
        sha256Hash: '6'.repeat(64),
        storagePath: '/tmp/mongoose_target_point0625.pdf'
      },
      landDetails: {
        landArea: { value: '0.0625', unit: 'Acre' }
      }
    });

    const resMatchGunta = compareDocuments(mongooseDoc1, targetDocAcrePoint0625);
    const areaAttrMatchGunta = resMatchGunta.landAttributes.find((a) => a.key === 'landArea');
    assert(areaAttrMatchGunta);
    assert.strictEqual(areaAttrMatchGunta.status, 'IDENTICAL');
    assert.strictEqual(areaAttrMatchGunta.docAValue, '2.5 Gunta');
    assert.strictEqual(areaAttrMatchGunta.docBValue, '0.0625 Acre');
    assert(areaAttrMatchGunta.explanation.includes('numerically equivalent after unit conversion'));

    // Verify non-area fields using ExtractedFieldSchema strictly drop unit properties
    const docWithInvalidUnit = new Document({
      fileMetadata: {
        originalFilename: 'test_invalid_unit.pdf',
        storedFilename: 'test_invalid_unit.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256Hash: '7'.repeat(64),
        storagePath: '/tmp/test_invalid_unit.pdf'
      },
      landDetails: {
        ownerName: { value: 'Rohan', unit: 'Acre' },
        village: { value: 'Shamshabad', unit: 'Gunta' },
        area: { value: '2.5', unit: 'Acre' }
      }
    });
    assert.strictEqual(docWithInvalidUnit.landDetails.ownerName.unit, undefined, 'ownerName must not accept a unit property');
    assert.strictEqual(docWithInvalidUnit.landDetails.village.unit, undefined, 'village must not accept a unit property');
    assert.strictEqual(docWithInvalidUnit.landDetails.area.unit, 'Acre', 'area must accept optional unit property');
  });

  runTest('45. Metadata Summary Counts: Accurately separates DIFFERENT from MISSING_IN_A / MISSING_IN_B while keeping differencesCount', () => {
    const d1 = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      createdAt: null, // MISSING_IN_A for uploadDate
      assignedOfficerId: new mongoose.Types.ObjectId('65f000000000000000000101'),
      fileMetadata: {
        originalFilename: 'meta_count_a.pdf',
        sizeBytes: 10000,
        sha256Hash: 'a'.repeat(64)
      }
    };
    const d2 = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      createdAt: new Date('2026-04-01T00:00:00Z'),
      assignedOfficerId: new mongoose.Types.ObjectId('65f000000000000000000202'),
      fileMetadata: {
        originalFilename: 'meta_count_b.pdf',
        sizeBytes: 20000,
        sha256Hash: null // MISSING_IN_B for sha256Hash
      }
    };

    const res = compareDocuments(d1, d2);
    // Expected metadata statuses:
    // originalFilename: DIFFERENT
    // uploadDate: MISSING_IN_A
    // fileSize: DIFFERENT
    // sha256Hash: MISSING_IN_B
    // documentStatus: IDENTICAL
    // assignedOfficer: DIFFERENT
    assert.strictEqual(res.summary.metadata.total, 6);
    assert.strictEqual(res.summary.metadata.identicalCount, 1);
    assert.strictEqual(res.summary.metadata.differentCount, 3, 'differentCount must only count status === DIFFERENT');
    assert.strictEqual(res.summary.metadata.missingInACount, 1);
    assert.strictEqual(res.summary.metadata.missingInBCount, 1);
    assert.strictEqual(res.summary.metadata.notRecordedCount, 0);
    assert.strictEqual(
      res.summary.metadata.differencesCount,
      res.metadataDifferences.length,
      'differencesCount must equal metadataDifferences.length (DIFFERENT + MISSING_IN_A + MISSING_IN_B)'
    );
    assert.strictEqual(res.summary.metadata.differencesCount, 5);
    assert.strictEqual(
      res.summary.metadata.identicalCount +
        res.summary.metadata.differentCount +
        res.summary.metadata.missingInACount +
        res.summary.metadata.missingInBCount +
        res.summary.metadata.notRecordedCount,
      res.summary.metadata.total
    );
    // Land discrepancies must remain completely isolated from metadata variance
    assert.strictEqual(res.summary.landDiscrepanciesCount, 0);
  });

  runTest('46. Assigned Officer Resolution: Uses canonical assignedOfficerId consistently in metadata and document summaries', () => {
    const officer1Id = new mongoose.Types.ObjectId();
    const officer2Id = new mongoose.Types.ObjectId();

    const docWithId1 = new Document({
      assignedOfficerId: officer1Id,
      assignedOfficer: 'legacy-should-be-overridden',
      fileMetadata: {
        originalFilename: 'officer_a.pdf',
        storedFilename: 'officer_a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256Hash: 'b'.repeat(64),
        storagePath: '/tmp/officer_a.pdf'
      },
      landDetails: {
        ownerName: { value: 'Ramesh' }
      }
    });

    const docWithPopulatedOfficer = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      assignedOfficerId: { _id: officer2Id, name: 'Officer Two' },
      landDetails: {
        ownerName: { value: 'Ramesh' }
      }
    };

    const res = compareDocuments(docWithId1, docWithPopulatedOfficer);
    assert.strictEqual(res.documentA.assignedOfficerId, officer1Id.toString());
    assert.strictEqual(res.documentA.assignedOfficer, officer1Id.toString());
    assert.strictEqual(res.documentB.assignedOfficerId, officer2Id.toString());
    assert.strictEqual(res.documentB.assignedOfficer, officer2Id.toString());

    const officerMeta = res.metadataAttributes.find((m) => m.key === 'assignedOfficer');
    assert(officerMeta);
    assert.strictEqual(officerMeta.docAValue, officer1Id.toString());
    assert.strictEqual(officerMeta.docBValue, officer2Id.toString());
    assert.strictEqual(officerMeta.status, 'DIFFERENT');

    // Same assignedOfficerId on plain doc + Mongoose doc -> IDENTICAL
    const plainSameOfficer = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      assignedOfficerId: officer1Id
    };
    const resSame = compareDocuments(docWithId1, plainSameOfficer);
    const sameOfficerMeta = resSame.metadataAttributes.find((m) => m.key === 'assignedOfficer');
    assert.strictEqual(sameOfficerMeta.status, 'IDENTICAL');
    assert.strictEqual(resSame.documentA.assignedOfficerId, officer1Id.toString());
    assert.strictEqual(resSame.documentB.assignedOfficerId, officer1Id.toString());

    // Legacy fallback still supported when assignedOfficerId is absent
    const docLegacyOnly = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      assignedOfficer: 'legacy-officer-42'
    };
    const docUnassigned = {
      ...docA,
      _id: new mongoose.Types.ObjectId()
    };
    const resLegacy = compareDocuments(docLegacyOnly, docUnassigned);
    assert.strictEqual(resLegacy.documentA.assignedOfficerId, 'legacy-officer-42');
    assert.strictEqual(resLegacy.documentA.assignedOfficer, 'legacy-officer-42');
    assert.strictEqual(resLegacy.documentB.assignedOfficerId, null);
    const legacyMeta = resLegacy.metadataAttributes.find((m) => m.key === 'assignedOfficer');
    assert.strictEqual(legacyMeta.docAValue, 'legacy-officer-42');
    assert.strictEqual(legacyMeta.docBValue, 'Unassigned');
    assert.strictEqual(legacyMeta.status, 'DIFFERENT');
  });

  await runAsyncTest('47. Mongoose Document & Subdocument Compatibility: extractFieldValue, custom-field discovery, unsaved and DB-hydrated docs', async () => {
    const { extractFieldValue } = require('./services/documentComparisonService');

    // Part A: Unsaved Mongoose Document instances & subdocuments
    const unsaved1 = new Document({
      fileMetadata: {
        originalFilename: 'unsaved_1.pdf',
        storedFilename: 'unsaved_1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1200,
        sha256Hash: 'c'.repeat(64),
        storagePath: '/tmp/unsaved_1.pdf'
      },
      landDetails: {
        ownerName: { value: 'Sita Devi', confidence: 0.94 },
        village: { value: 'Shamshabad', confidence: 0.91 },
        district: { value: '' },
        landArea: { value: '2.5', unit: 'Acre', confidence: 0.9 }
      }
    });
    unsaved1.set('landDetails.zilla', { value: 'Rangareddy', confidence: 0.89 }, { strict: false });
    unsaved1.set('landDetails.customKhataType', { value: 'Patta', confidence: 0.87 }, { strict: false });
    unsaved1.set('landDetails.customTags', ['irrigated', 'borewell'], { strict: false });

    const unsaved2 = new Document({
      fileMetadata: {
        originalFilename: 'unsaved_2.pdf',
        storedFilename: 'unsaved_2.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1300,
        sha256Hash: 'd'.repeat(64),
        storagePath: '/tmp/unsaved_2.pdf'
      },
      landDetails: {
        ownerName: { value: 'Sita Devi', confidence: 0.92 },
        village: { value: 'Maheshwaram', confidence: 0.95 },
        district: { value: 'Rangareddy', confidence: 0.96 },
        landArea: { value: '100', unit: 'Gunta', confidence: 0.91 }
      }
    });
    unsaved2.set('landDetails.customKhataType', { value: 'Laoni Patta', confidence: 0.84 }, { strict: false });

    // Direct extractFieldValue on Mongoose landDetails subdocument wrapper
    const extOwner = extractFieldValue(unsaved1.landDetails, ['ownerName', 'owner']);
    assert.strictEqual(extOwner.isPresent, true);
    assert.strictEqual(extOwner.isUnsupportedStructure, false, 'Mongoose subdocument must not be treated as Complex Object');
    assert.strictEqual(extOwner.value, 'Sita Devi');
    assert.strictEqual(extOwner.confidence, 0.94);

    // Direct extractFieldValue on empty schema default subdocument (surveyNumber)
    const extSurveyDefault = extractFieldValue(unsaved1.landDetails, ['surveyNumber']);
    assert.strictEqual(extSurveyDefault.isPresent, false);
    assert.strictEqual(extSurveyDefault.isUnsupportedStructure, false, 'Empty Mongoose subdocument default must not be treated as Complex Object');

    const resUnsaved = compareDocuments(unsaved1, unsaved2);
    const ownerAttr = resUnsaved.landAttributes.find((a) => a.key === 'ownerName');
    const districtAttr = resUnsaved.landAttributes.find((a) => a.key === 'district');
    const customKhataAttr = resUnsaved.landAttributes.find((a) => a.key === 'custom_customKhataType');
    const customTagsAttr = resUnsaved.landAttributes.find((a) => a.key === 'custom_customTags');
    const incomparableNonCustom = resUnsaved.landAttributes.filter(
      (a) => !a.key.startsWith('custom_') && a.status === 'INCOMPARABLE'
    );
    assert.strictEqual(incomparableNonCustom.length, 0, 'Standard Mongoose subdocument fields must not produce spurious INCOMPARABLE');
    assert.strictEqual(ownerAttr.status, 'IDENTICAL');
    assert.strictEqual(districtAttr.status, 'IDENTICAL', 'Empty schema district on unsaved Mongoose doc must fall back to zilla');
    assert(customKhataAttr && customKhataAttr.status === 'DIFFERENT');
    assert.strictEqual(customKhataAttr.docAValue, 'Patta');
    assert.strictEqual(customKhataAttr.docBValue, 'Laoni Patta');
    assert(customTagsAttr && customTagsAttr.status === 'INCOMPARABLE');
    assert.strictEqual(unsaved1.landDetails.ownerName.value, 'Sita Devi', 'Must not mutate original Mongoose doc');

    // Part B: DB-hydrated Mongoose Document instances (Model.findById)
    const dbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/digibhoomi_rbac_test';
    const shouldConnect = mongoose.connection.readyState === 0;
    const createdIds = [];
    try {
      if (shouldConnect) {
        await mongoose.connect(dbUri);
      }
      const userId = new mongoose.Types.ObjectId();
      const officerId = new mongoose.Types.ObjectId();

      const saved1 = await new Document({
        status: 'Needs review',
        assignedOfficerId: officerId,
        accessControl: { uploadedBy: userId },
        fileMetadata: {
          originalFilename: 'db_hydrated_1.pdf',
          storedFilename: 'db_hydrated_1.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2200,
          sha256Hash: 'e'.repeat(64),
          storagePath: '/tmp/db_hydrated_1.pdf'
        },
        landDetails: {
          ownerName: { value: 'K. Venkat', confidence: 0.93 },
          surveyNumber: { value: '77/B', confidence: 0.95 },
          district: { value: '' },
          landArea: { value: '1', unit: 'Hectare', confidence: 0.9 }
        }
      }).save();
      createdIds.push(saved1._id);

      await Document.collection.updateOne(
        { _id: saved1._id },
        {
          $set: {
            'landDetails.zilla': { value: 'Rangareddy', confidence: 0.9 },
            'landDetails.customTaxId': { value: 'TX-2026', confidence: 0.89 },
            'landDetails.customCoords': { lat: 17.3, lng: 78.4 }
          }
        }
      );

      const saved2 = await new Document({
        status: 'Needs review',
        assignedOfficerId: officerId,
        accessControl: { uploadedBy: userId },
        fileMetadata: {
          originalFilename: 'db_hydrated_2.pdf',
          storedFilename: 'db_hydrated_2.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2300,
          sha256Hash: 'f'.repeat(64),
          storagePath: '/tmp/db_hydrated_2.pdf'
        },
        landDetails: {
          ownerName: { value: 'K. Venkat', confidence: 0.91 },
          surveyNumber: { value: '77/B', confidence: 0.94 },
          district: { value: 'Rangareddy', confidence: 0.97 },
          landArea: { value: '2.471', unit: 'Acre', confidence: 0.9 }
        }
      }).save();
      createdIds.push(saved2._id);

      await Document.collection.updateOne(
        { _id: saved2._id },
        {
          $set: {
            'landDetails.customTaxId': { value: 'TX-2026', confidence: 0.88 }
          }
        }
      );

      const hydrated1 = await Document.findById(saved1._id);
      const hydrated2 = await Document.findById(saved2._id);
      assert(hydrated1 && hydrated2);

      const dbExtOwner = extractFieldValue(hydrated1.landDetails, ['ownerName']);
      assert.strictEqual(dbExtOwner.value, 'K. Venkat');
      assert.strictEqual(dbExtOwner.isUnsupportedStructure, false);

      const dbExtDistrict = extractFieldValue(hydrated1.landDetails, ['district', 'dist', 'zilla', 'zila']);
      assert.strictEqual(dbExtDistrict.isPresent, true);
      assert.strictEqual(dbExtDistrict.value, 'Rangareddy');

      const resHydrated = compareDocuments(hydrated1, hydrated2);
      assert.strictEqual(resHydrated.documentA.assignedOfficerId, officerId.toString());
      assert.strictEqual(resHydrated.metadataAttributes.find((m) => m.key === 'assignedOfficer').docAValue, officerId.toString());
      assert.strictEqual(resHydrated.landAttributes.find((a) => a.key === 'ownerName').status, 'IDENTICAL');
      assert.strictEqual(resHydrated.landAttributes.find((a) => a.key === 'surveyNumber').status, 'IDENTICAL');
      assert.strictEqual(resHydrated.landAttributes.find((a) => a.key === 'district').status, 'IDENTICAL');
      assert.strictEqual(resHydrated.landAttributes.find((a) => a.key === 'landArea').status, 'IDENTICAL');

      const taxAttr = resHydrated.landAttributes.find((a) => a.key === 'custom_customTaxId');
      assert(taxAttr, 'DB-persisted customTaxId must be discovered from Mongoose Document');
      assert.strictEqual(taxAttr.status, 'IDENTICAL');
      assert.strictEqual(taxAttr.docAValue, 'TX-2026');

      const coordsAttr = resHydrated.landAttributes.find((a) => a.key === 'custom_customCoords');
      assert(coordsAttr, 'DB-persisted unmapped complex customCoords must be discovered and marked INCOMPARABLE');
      assert.strictEqual(coordsAttr.status, 'INCOMPARABLE');
      assert.strictEqual(hydrated1.landDetails.ownerName.value, 'K. Venkat');
    } finally {
      if (createdIds.length > 0 && mongoose.connection.readyState === 1) {
        await Document.deleteMany({ _id: { $in: createdIds } });
      }
      if (shouldConnect && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  });

  runTest('48. Semantic Alias Fallback: Empty/null/undefined earlier aliases fall through to populated later alias', () => {
    const { extractFieldValue } = require('./services/documentComparisonService');

    // Case 1: { value: null } in earlier alias + populated later alias
    const fNull = extractFieldValue(
      { district: { value: null }, zilla: { value: 'Rangareddy', confidence: 0.94 } },
      ['district', 'dist', 'zilla', 'zila']
    );
    assert.strictEqual(fNull.isPresent, true);
    assert.strictEqual(fNull.isUnsupportedStructure, false);
    assert.strictEqual(fNull.value, 'Rangareddy');
    assert.strictEqual(fNull.confidence, 0.94);

    // Case 2: { value: undefined } and empty { value: '' } and empty object {}
    const fMultiEmpty = extractFieldValue(
      { district: { value: undefined }, dist: {}, zilla: { value: '   ' }, zila: 'Medak' },
      ['district', 'dist', 'zilla', 'zila']
    );
    assert.strictEqual(fMultiEmpty.isPresent, true);
    assert.strictEqual(fMultiEmpty.value, 'Medak');

    // Case 3: Empty primitive '' before populated alias
    const fEmptyStr = extractFieldValue(
      { district: '', zilla: { value: 'Khammam', confidence: 0.88 } },
      ['district', 'dist', 'zilla', 'zila']
    );
    assert.strictEqual(fEmptyStr.isPresent, true);
    assert.strictEqual(fEmptyStr.value, 'Khammam');

    // Case 4: { value: null } with NO fallback must be treated as absent/empty, NOT Complex Object
    const fNullOnly = extractFieldValue(
      { district: { value: null, confidence: 0.5 } },
      ['district', 'dist', 'zilla', 'zila']
    );
    assert.strictEqual(fNullOnly.isPresent, false);
    assert.strictEqual(fNullOnly.isUnsupportedStructure, false);
    assert.strictEqual(fNullOnly.displayValue, '(Empty)');

    // Case 5: Populated earlier alias still wins over later alias
    const fFirstWins = extractFieldValue(
      { district: { value: 'Hyderabad' }, zilla: { value: 'Rangareddy' } },
      ['district', 'dist', 'zilla', 'zila']
    );
    assert.strictEqual(fFirstWins.value, 'Hyderabad');

    // Case 6: Full compareDocuments with district: { value: null } + zilla: { value: 'Rangareddy' }
    const docAliasA = {
      ...docA,
      _id: new mongoose.Types.ObjectId(),
      landDetails: {
        ...docA.landDetails,
        district: { value: null },
        zilla: { value: 'Rangareddy', confidence: 0.92 }
      }
    };
    const resAlias = compareDocuments(docAliasA, docA);
    const districtRes = resAlias.landAttributes.find((a) => a.key === 'district');
    assert.strictEqual(districtRes.status, 'IDENTICAL');
    assert.strictEqual(districtRes.docAValue, 'Rangareddy');
    assert.strictEqual(resAlias.landAttributes.some((a) => a.key === 'custom_zilla'), false, 'Semantic alias zilla must remain excluded from custom fields');
  });

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runDocumentComparisonTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
