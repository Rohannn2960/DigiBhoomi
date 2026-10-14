const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:5000';
const FIXTURES_DIR = path.resolve(__dirname, 'test_fixtures');

async function runGeminiLiveTest() {
  console.log('====================================================');
  console.log('   DigiBhoomi Live Gemini Extraction Verification');
  console.log('====================================================\n');

  // Step 1: Upload a non-sensitive sample document
  const samplePath = path.join(FIXTURES_DIR, 'english_record.png');
  const sampleBytes = fs.readFileSync(samplePath);
  const sampleBlob = new Blob([sampleBytes], { type: 'image/png' });
  const formData = new FormData();
  formData.append('file', sampleBlob, 'sample_land_record_gemini_test.png');

  console.log('1. Uploading test document to MongoDB...');
  const uploadRes = await fetch(`${BASE_URL}/api/documents`, {
    method: 'POST',
    body: formData
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload failed with status ${uploadRes.status}`);
  }

  const uploadedDoc = await uploadRes.json();
  console.log(`   -> Uploaded Doc ID: ${uploadedDoc._id}`);
  console.log(`   -> Initial Status: ${uploadedDoc.status}\n`);

  // Step 2: Trigger Gemini Processing via POST /api/documents/:id/process
  console.log('2. Sending document to Gemini multimodal extraction API (engine: gemini)...');
  const startTime = Date.now();
  const processRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine: 'gemini', language: 'en' })
  });

  const durationMs = Date.now() - startTime;
  const processedDoc = await processRes.json();

  if (!processRes.ok) {
    console.error('Gemini Processing Error Response:', processedDoc);
    throw new Error(processedDoc.error || `Process failed with HTTP ${processRes.status}`);
  }

  console.log(`   -> Completed in: ${durationMs} ms`);
  console.log(`   -> Returned Status: ${processedDoc.status}`);
  console.log(`   -> Engine: ${processedDoc.ocrResult?.engine}`);
  console.log(`   -> Model: ${processedDoc.ocrResult?.model}`);
  console.log(`   -> Detected Language: ${processedDoc.ocrResult?.detectedLanguage}`);
  console.log(`   -> Raw Transcribed OCR Text Length: ${processedDoc.ocrResult?.fullText?.length || 0} characters\n`);

  // Step 3: Validate Extracted Fields & Non-Fabrication Rules
  console.log('3. Validating Extracted Schema & Rules:');
  const ld = processedDoc.landDetails || {};
  
  console.log(`   - Owner Name: "${ld.ownerName?.value}" (source: ${ld.ownerName?.confidenceSource}, confidence: ${ld.ownerName?.confidence})`);
  console.log(`   - Survey Number: "${ld.surveyNumber?.value}" (source: ${ld.surveyNumber?.confidenceSource})`);
  console.log(`   - Khata Number: "${ld.khataNumber?.value}" (isFlagged: ${ld.khataNumber?.isFlagged})`);
  console.log(`   - Land Area: "${ld.landArea?.value} ${ld.landArea?.unit}"`);
  console.log(`   - Village: "${ld.village?.value}"`);
  console.log(`   - Tehsil: "${ld.tehsil?.value}"`);
  console.log(`   - District: "${ld.district?.value}"`);
  console.log(`   - Land Classification: "${ld.landClassification?.value}"\n`);

  const hasEngineName = processedDoc.ocrResult?.engine?.includes('Google Gemini');
  const hasFullText = Boolean(processedDoc.ocrResult?.fullText && processedDoc.ocrResult.fullText.length > 0);
  const confidenceIsCalibratedNull = ld.ownerName?.confidence === null;
  const confidenceSourceIsGemini = ld.ownerName?.confidenceSource === 'GEMINI_MULTIMODAL';
  const statusIsNeedsReview = processedDoc.status === 'Needs review';

  // Step 4: Verify MongoDB Persistence by reading record fresh via GET /api/documents/:id
  console.log('4. Verifying MongoDB persistence via GET /api/documents/:id...');
  const fetchRes = await fetch(`${BASE_URL}/api/documents/${uploadedDoc._id}`);
  const persistedDoc = await fetchRes.json();
  const persistsInDb = 
    persistedDoc.status === 'Needs review' &&
    persistedDoc.ocrResult?.engine?.includes('Google Gemini') &&
    persistedDoc.ocrResult?.fullText === processedDoc.ocrResult?.fullText;

  console.log(`   -> Persisted In DB: ${persistsInDb}\n`);

  console.log('====================================================');
  console.log('Verification Checklist:');
  console.log(`[${hasEngineName ? 'PASS' : 'FAIL'}] Real Gemini Engine Invoked`);
  console.log(`[${hasFullText ? 'PASS' : 'FAIL'}] Verbatim Raw Text Transcribed`);
  console.log(`[${confidenceIsCalibratedNull ? 'PASS' : 'FAIL'}] Confidence Left Uncalibrated/Null`);
  console.log(`[${confidenceSourceIsGemini ? 'PASS' : 'FAIL'}] ConfidenceSource Tagged 'GEMINI_MULTIMODAL'`);
  console.log(`[${statusIsNeedsReview ? 'PASS' : 'FAIL'}] Final Status Set to 'Needs review'`);
  console.log(`[${persistsInDb ? 'PASS' : 'FAIL'}] Results Persist in MongoDB`);
  console.log('====================================================\n');
}

runGeminiLiveTest().catch(console.error);
