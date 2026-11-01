const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { TEST_API_ORIGIN, TEST_MONGODB_URI } = require('./test_helpers/config');
const { uploadDir } = require('./middleware/upload');
const { installTestIdentity } = require('./test_helpers/auth');

const BASE_URL = TEST_API_ORIGIN;
const PYTHON_URL = 'http://127.0.0.1:8000';
const FIXTURES_DIR = path.resolve(__dirname, 'test_fixtures');
const UPLOADS_DIR = uploadDir;
const EXPECTED_GEMINI_MODEL = 'gemini-3.5-flash-lite';
const createdDocumentIds = new Set();
const createdStoredFilenames = new Set();
let restoreTestIdentity = null;

async function cleanupCreatedResources() {
  const Document = require('./models/Document');
  if (mongoose.connection.readyState === 1 && createdDocumentIds.size > 0) {
    await Document.deleteMany({ _id: { $in: Array.from(createdDocumentIds) } });
  }
  await Promise.all(Array.from(createdStoredFilenames, async (filename) => {
    const resolvedPath = path.resolve(UPLOADS_DIR, path.basename(filename));
    if (resolvedPath.startsWith(UPLOADS_DIR)) {
      await fs.promises.unlink(resolvedPath).catch(() => {});
    }
  }));
}

function printSummary(results) {
  console.log('\n====================================================');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`Summary: ${passed}/${total} Acceptance Tests Passed.`);
  console.log('====================================================\n');
}

async function runTests() {
  console.log('====================================================');
  console.log('   DigiBhoomi Phase 3 Acceptance Verification');
  console.log('====================================================\n');

  const results = [];
  const assert = (title, condition, extra = '') => {
    if (condition) {
      console.log(`\x1b[32m✔ PASS\x1b[0m: ${title} ${extra}`);
      results.push({ title, pass: true, extra });
    } else {
      console.log(`\x1b[31m✘ FAIL\x1b[0m: ${title} ${extra}`);
      results.push({ title, pass: false, extra });
    }
  };

  try {
    await mongoose.connect(TEST_MONGODB_URI);
  } catch {
    assert('MongoDB is available for acceptance testing', false, 'Connection failed.');
    printSummary(results);
    return;
  }

  try {
    restoreTestIdentity = await installTestIdentity('Admin');
  } catch (err) {
    assert('Authenticated test identity is available', false, err.message);
    printSummary(results);
    return;
  }

  // Test 1: Service Health Checks
  try {
    const backendRes = await fetch(`${BASE_URL}/api/health`);
    const backendData = await backendRes.json();
    assert(
      'Test 1a: Express Backend starts and returns healthy',
      backendRes.ok && backendData.status === 'healthy' && backendData.database === 'connected'
    );

    const pyRes = await fetch(`${PYTHON_URL}/health`);
    const pyData = await pyRes.json();
    assert(
      'Test 1b: Python Document Extraction Service starts and returns healthy',
      pyRes.ok && pyData.status === 'healthy' && pyData.primaryEngine === 'Google Gemini',
      `[Model: ${pyData.geminiModel}, Local Engine: ${pyData.fallbackEngine}]`
    );
  } catch (err) {
    assert('Test 1: Health check endpoints accessible', false, err.message);
  }

  // Test 2: Gemini API Configuration
  try {
    const pyRes = await fetch(`${PYTHON_URL}/health`);
    const pyData = await pyRes.json();
    assert(
      'Test 2: Gemini configuration is read from environment without hardcoding',
      pyData.geminiModel === EXPECTED_GEMINI_MODEL,
      `[geminiConfigured: ${pyData.geminiConfigured}]`
    );
  } catch (err) {
    assert('Test 2: Gemini config check', false, err.message);
  }

  // Test 3: Existing Document Upload & SHA-256 Hashing (Phase 2 preservation)
  let uploadedDoc = null;
  const englishSamplePath = path.join(FIXTURES_DIR, 'english_record.png');
  const requiredFixtures = ['english_record.png', 'hindi_record.png', 'telugu_record.png'];
  const missingFixtures = requiredFixtures.filter(name => !fs.existsSync(path.join(FIXTURES_DIR, name)));
  if (missingFixtures.length > 0) {
    assert(
      'Required document fixtures are available',
      false,
      `Missing fixture(s): ${missingFixtures.join(', ')}.`
    );
    printSummary(results);
    return;
  }
  const originalBytes = fs.readFileSync(englishSamplePath);
  const expectedHash = crypto.createHash('sha256').update(originalBytes).digest('hex');

  try {
    const blob = new Blob([originalBytes], { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', blob, 'english_record.png');

    const uploadRes = await fetch(`${BASE_URL}/api/documents`, {
      method: 'POST',
      body: formData
    });
    uploadedDoc = await uploadRes.json();

    assert(
      'Test 3: Existing upload flow creates MongoDB document with SHA-256 hash',
      uploadRes.status === 201 && uploadedDoc.fileMetadata.sha256Hash === expectedHash,
      `[ID: ${uploadedDoc._id}, Status: ${uploadedDoc.status}]`
    );
    if (uploadRes.ok && uploadedDoc._id) {
      createdDocumentIds.add(uploadedDoc._id);
      if (uploadedDoc.fileMetadata?.storedFilename) {
        createdStoredFilenames.add(uploadedDoc.fileMetadata.storedFilename);
      }
    }
  } catch (err) {
    assert('Test 3: Document upload', false, err.message);
  }

  // Test 4: Document File Streaming Preview (Phase 2 preservation)
  if (uploadedDoc) {
    try {
      const fileRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}/file`);
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      const previewHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      assert(
        'Test 4: Document preview streams original file intact',
        fileRes.ok && fileRes.headers.get('content-type') === 'image/png' && previewHash === expectedHash
      );
    } catch (err) {
      assert('Test 4: Document preview stream', false, err.message);
    }
  }

  // Test 5: End-to-End Document Processing with Local Engine Fallback
  let processedDoc = null;
  if (uploadedDoc) {
    try {
      console.log('   -> Initiating OCR processing on document...');
      const processRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'local', language: 'en' })
      });
      processedDoc = await processRes.json();

      assert(
        'Test 5: POST /api/documents/:id/process runs OCR and transitions to "Needs review"',
        processRes.ok && processedDoc.status === 'Needs review',
        `[Engine: ${processedDoc.ocrResult?.engine}, Status: ${processedDoc.status}]`
      );
    } catch (err) {
      assert('Test 5: Process endpoint execution', false, err.message);
    }
  }

  // Test 6: Extracted Fields Schema Conformance
  if (processedDoc && processedDoc.landDetails) {
    const ld = processedDoc.landDetails;
    const requiredFields = ['ownerName', 'surveyNumber', 'khataNumber', 'landArea', 'village', 'tehsil', 'district', 'landClassification'];
    const allFieldsPresent = requiredFields.every(f => ld[f] !== undefined);

    const ownerFieldConforms = 
      ld.ownerName && 
      typeof ld.ownerName.value === 'string' &&
      ld.ownerName.reviewStatus === 'Unreviewed' &&
      ('confidence' in ld.ownerName) &&
      ('confidenceSource' in ld.ownerName);

    const hasNumericLocalConfidence =
      typeof processedDoc.ocrResult?.meanConfidence === 'number' &&
      typeof ld.ownerName?.confidence === 'number' &&
      typeof ld.landArea?.confidence === 'number';

    assert(
      'Test 6: Extracted fields conform strictly to defined schema',
      allFieldsPresent && ownerFieldConforms && hasNumericLocalConfidence,
      `[Owner: "${ld.ownerName.value}", Area: "${ld.landArea.value} ${ld.landArea.unit}", meanConfidence: ${processedDoc.ocrResult?.meanConfidence}]`
    );
  }

  // Test 7: Missing fields remain empty rather than fabricated
  if (processedDoc && processedDoc.landDetails) {
    const ld = processedDoc.landDetails;
    // In english_record.png, khataNumber or classification may be absent
    const missingField = ld.khataNumber;
    const unFabricated = missingField && (missingField.value === '' || missingField.value === null) && missingField.isFlagged === true;

    assert(
      'Test 7: Missing fields remain empty/null and flagged rather than fabricated',
      unFabricated,
      `[Khata value: "${missingField?.value}", isFlagged: ${missingField?.isFlagged}]`
    );
  }

  // Test 8: Raw OCR text and processing metadata persist in MongoDB
  if (processedDoc) {
    try {
      // Re-fetch document directly from GET /api/documents/:id to verify persistence
      const fetchRes = await fetch(`${BASE_URL}/api/documents/${processedDoc._id}`);
      const persistedDoc = await fetchRes.json();

      const ocrPersisted = 
        persistedDoc.ocrResult &&
        persistedDoc.ocrResult.fullText &&
        persistedDoc.ocrResult.fullText.length > 0 &&
        persistedDoc.ocrResult.processedAt &&
        persistedDoc.ocrResult.engine;
      const validationPersisted =
        typeof persistedDoc.extractionValidation?.score === 'number' &&
        persistedDoc.extractionValidation?.categories?.requiredFields &&
        Array.isArray(persistedDoc.extractionValidation?.failedChecks);

      assert(
        'Test 8: Raw OCR text and metadata persist in MongoDB',
        Boolean(ocrPersisted),
        `[Length: ${persistedDoc.ocrResult?.fullText?.length} chars, ProcessedAt: ${persistedDoc.ocrResult?.processedAt}]`
      );
      assert(
        'Test 8b: Extraction validation score and review checks persist in MongoDB',
        Boolean(validationPersisted),
        `[Score: ${persistedDoc.extractionValidation?.score}, Failed checks: ${persistedDoc.extractionValidation?.failedChecks?.length}]`
      );
    } catch (err) {
      assert('Test 8: MongoDB persistence check', false, err.message);
    }
  }

  // Test 9: Unicode preservation for synthetic Hindi and Telugu records.
  try {
    // 9a: Verify Hindi Devanagari Unicode storage and retrieval in MongoDB.
    const Document = require('./models/Document');
    const hindiSampleDoc = new Document({
      fileMetadata: {
        originalFilename: 'hindi_land_record_jamabandi.png',
        storedFilename: 'test_hindi_sample.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
        sha256Hash: crypto.createHash('sha256').update('hindi_test').digest('hex'),
        storagePath: path.join(FIXTURES_DIR, 'hindi_record.png')
      },
      status: 'Needs review',
      ocrResult: {
        fullText: 'खाता संख्या: 45\nखसरा संख्या: 120/4\nखातेदार का नाम: रामेश्वर शर्मा\nग्राम: रामपुर\nतहसील: झाँसी\nजिला: झाँसी\nक्षेत्रफल: 3.5 बीघा\nभूमि की श्रेणी: कृषि भूमि',
        detectedLanguage: 'HINDI',
        engine: 'Synthetic Unicode fixture',
        model: 'test-fixture',
        processedAt: new Date()
      },
      landDetails: {
        ownerName: { value: 'रामेश्वर शर्मा', rawText: 'खातेदार का नाम: रामेश्वर शर्मा', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        surveyNumber: { value: '120/4', rawText: 'खसरा संख्या: 120/4', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        khasraNumber: { value: '120/4', rawText: 'खसरा संख्या: 120/4', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        khataNumber: { value: '45', rawText: 'खाता संख्या: 45', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        landArea: { value: '3.5', unit: 'Bigha', rawText: 'क्षेत्रफल: 3.5 बीघा', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        village: { value: 'रामपुर', rawText: 'ग्राम: रामपुर', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        tehsil: { value: 'झाँसी', rawText: 'तहसील: झाँसी', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        district: { value: 'झाँसी', rawText: 'जिला: झाँसी', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        landClassification: { value: 'कृषि भूमि', rawText: 'भूमि की श्रेणी: कृषि भूमि', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' }
      }
    });

    const savedHindi = await hindiSampleDoc.save();
    createdDocumentIds.add(savedHindi._id);
    const fetchedHindiRes = await fetch(`${BASE_URL}/api/documents/${savedHindi._id}`);
    const fetchedHindi = await fetchedHindiRes.json();

    const devanagariPreserved = 
      fetchedHindi.landDetails?.ownerName?.value === 'रामेश्वर शर्मा' &&
      fetchedHindi.landDetails?.district?.value === 'झाँसी' &&
      fetchedHindi.ocrResult?.fullText.includes('खातेदार का नाम: रामेश्वर शर्मा');

    assert(
      'Test 9a: Hindi Devanagari Unicode survives MongoDB storage and retrieval',
      devanagariPreserved,
      `[Owner: "${fetchedHindi.landDetails?.ownerName?.value}", District: "${fetchedHindi.landDetails?.district?.value}"]`
    );

    // 9b: Verify Telugu Unicode storage and retrieval in MongoDB.
    const teluguSampleDoc = new Document({
      fileMetadata: {
        originalFilename: 'telugu_land_record_patta.png',
        storedFilename: 'test_telugu_sample.png',
        mimeType: 'image/png',
        sizeBytes: 1024,
        sha256Hash: crypto.createHash('sha256').update('telugu_test').digest('hex'),
        storagePath: path.join(FIXTURES_DIR, 'telugu_record.png')
      },
      status: 'Needs review',
      ocrResult: {
        fullText: 'పట్టాదారు పేరు: వెంకటేశ్వర రావు\nసర్వే నంబరు: 108/2\nఖాతా నంబరు: 320\nగ్రామం: కొత్తపల్లి\nమండలం: అమరావతి\nజిల్లా: గుంటూరు\nవిస్తీర్ణం: 2.75 ఎకరాలు\nభూమి రకం: మాగాణి',
        detectedLanguage: 'TELUGU',
        engine: 'Synthetic Unicode fixture',
        model: 'test-fixture',
        processedAt: new Date()
      },
      landDetails: {
        ownerName: { value: 'వెంకటేశ్వర రావు', rawText: 'పట్టాదారు పేరు: వెంకటేశ్వర రావు', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        surveyNumber: { value: '108/2', rawText: 'సర్వే నంబరు: 108/2', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        khasraNumber: { value: '108/2', rawText: 'సర్వే నంబరు: 108/2', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        khataNumber: { value: '320', rawText: 'ఖాతా నంబరు: 320', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        landArea: { value: '2.75', unit: 'Acre', rawText: 'విస్తీర్ణం: 2.75 ఎకరాలు', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        village: { value: 'కొత్తపల్లి', rawText: 'గ్రామం: కొత్తపల్లి', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        tehsil: { value: 'అమరావతి', rawText: 'మండలం: అమరావతి', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        district: { value: 'గుంటూరు', rawText: 'జిల్లా: గుంటూరు', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' },
        landClassification: { value: 'మాగాణి', rawText: 'భూమి రకం: మాగాణి', confidence: null, confidenceSource: 'GEMINI_MULTIMODAL', reviewStatus: 'Unreviewed' }
      }
    });

    const savedTelugu = await teluguSampleDoc.save();
    createdDocumentIds.add(savedTelugu._id);
    const fetchedTeluguRes = await fetch(`${BASE_URL}/api/documents/${savedTelugu._id}`);
    const fetchedTelugu = await fetchedTeluguRes.json();

    const teluguPreserved = 
      fetchedTelugu.landDetails?.ownerName?.value === 'వెంకటేశ్వర రావు' &&
      fetchedTelugu.landDetails?.district?.value === 'గుంటూరు' &&
      fetchedTelugu.ocrResult?.fullText.includes('పట్టాదారు పేరు: వెంకటేశ్వర రావు');

    assert(
      'Test 9b: Telugu Unicode survives MongoDB storage and retrieval',
      teluguPreserved,
      `[Owner: "${fetchedTelugu.landDetails?.ownerName?.value}", District: "${fetchedTelugu.landDetails?.district?.value}"]`
    );
  } catch (err) {
    assert('Test 9: Multilingual Unicode test', false, err.message);
  }

  // Test 10: Invalid IDs, 404s, and Error Handling
  try {
    const invalidIdRes = await fetch(`${BASE_URL}/api/documents/invalid-mongo-id/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'local' })
    });
    assert('Test 10a: Invalid document ID format returns HTTP 400', invalidIdRes.status === 400);

    const nonExistentRes = await fetch(`${BASE_URL}/api/documents/507f1f77bcf86cd799439011/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'local' })
    });
    assert('Test 10b: Non-existent document ID returns HTTP 404', nonExistentRes.status === 404);
  } catch (err) {
    assert('Test 10: Error handling tests', false, err.message);
  }

  // Test 11: Failures do not leave records stuck in "Processing"
  if (uploadedDoc) {
    try {
      // Use an invalid engine to trigger a deterministic handled processing error.
      const invalidEngineRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: 'invalid-test-engine' })
      });

      // Verify the record status in DB
      const checkRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}`);
      const checkDoc = await checkRes.json();

      assert(
        'Test 11: Invalid processing engine resets document status and records the error',
        checkDoc.status !== 'Processing' &&
          invalidEngineRes.status === 502 &&
          typeof checkDoc.ocrResult?.error === 'string' &&
          checkDoc.ocrResult.error.includes("Unknown processing engine 'invalid-test-engine'"),
        `[Status after handled failure: "${checkDoc.status}", Error recorded: "${checkDoc.ocrResult?.error?.substring(0, 40)}..."]`
      );
    } catch (err) {
      assert('Test 11: Stuck state verification', false, err.message);
    }
  }

  // Test 12: Original uploaded files remain intact
  if (uploadedDoc) {
    try {
      const fileRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}/file`);
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      const postProcessHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      assert(
        'Test 12: Original file on disk remains completely intact and uncorrupted after processing',
        postProcessHash === expectedHash
      );
    } catch (err) {
      assert('Test 12: File integrity check', false, err.message);
    }
  }

  printSummary(results);
}

runTests()
  .catch((err) => {
    console.error('Acceptance suite aborted:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupCreatedResources();
    } catch (err) {
      console.error('Acceptance cleanup failed:', err.message);
      process.exitCode = 1;
    }
    try {
      if (restoreTestIdentity) await restoreTestIdentity();
    } catch (err) {
      console.error('Test identity cleanup failed:', err.message);
      process.exitCode = 1;
    }
    try {
      await mongoose.disconnect();
    } catch (_) {}
  });
