const fs = require('fs');
const path = require('path');
const assert = require('assert');

const BASE_URL = 'http://localhost:5000/api';
const FIXTURES_DIR = path.resolve(__dirname, 'test_fixtures');

async function testUploadAndReviewFlow() {
  console.log('====================================================');
  console.log('   Testing Upload & Review Page API Flow');
  console.log('====================================================\n');

  let uploadedDocId = null;

  try {
    // 1. Upload a valid document (like on UploadPage)
    console.log('Step 1: Upload a valid document via POST /api/documents');
    const samplePath = path.join(FIXTURES_DIR, 'sample.png');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(samplePath)], { type: 'image/png' }), 'test_upload_sample.png');

    const uploadRes = await fetch(`${BASE_URL}/documents`, {
      method: 'POST',
      body: form
    });
    assert.strictEqual(uploadRes.status, 201, `Upload failed with status ${uploadRes.status}`);
    const uploadData = await uploadRes.json();
    uploadedDocId = uploadData._id;

    assert(uploadedDocId, 'Upload must return a valid _id');
    assert.strictEqual(uploadData.status, 'Uploaded', 'Initial status must be "Uploaded"');
    console.log(`  ✓ Pass: Document uploaded successfully with ID: ${uploadedDocId}\n`);

    // 2. Fetch the newly uploaded document (as ReviewPage does on load)
    console.log('Step 2: Fetch document by ID (as ReviewPage does on initial mount)');
    const getRes = await fetch(`${BASE_URL}/documents/${uploadedDocId}`);
    assert.strictEqual(getRes.status, 200, `Fetch document failed with status ${getRes.status}`);
    const docData = await getRes.json();

    assert(docData.fileMetadata, 'fileMetadata must be present');
    assert(docData.fileMetadata.previewUrl, 'previewUrl must be synthesized');
    assert(!docData.fileMetadata.storagePath, 'storagePath must be hidden');
    assert.strictEqual(docData.status, 'Uploaded');
    console.log('  ✓ Pass: Freshly uploaded document metadata retrieved cleanly without crash.\n');

    // 3. Test document with no prior detection results calling /conflicts
    console.log('Step 3: Call GET /conflicts on document with no prior detection results');
    const conflictsRes = await fetch(`${BASE_URL}/documents/${uploadedDocId}/conflicts`);
    assert.strictEqual(conflictsRes.status, 200);
    const conflictsData = await conflictsRes.json();
    assert(conflictsData.duplicateDetection !== undefined, 'duplicateDetection must be returned');
    assert(conflictsData.conflictDetection !== undefined, 'conflictDetection must be returned');
    assert(Array.isArray(conflictsData.duplicateDetection.matches), 'matches must be an array');
    assert(Array.isArray(conflictsData.conflictDetection.conflicts), 'conflicts must be an array');
    console.log(`  ✓ Pass: Detection returned ${conflictsData.duplicateDetection.duplicateCount} duplicate(s) and ${conflictsData.conflictDetection.conflictCount} conflict(s).\n`);

    // 4. Test handling of non-existent / invalid document IDs (failed detection requests)
    console.log('Step 4: Test error handling for non-existent and invalid document IDs');
    const invalidIdRes = await fetch(`${BASE_URL}/documents/invalid-id-format/conflicts`);
    assert.strictEqual(invalidIdRes.status, 400);

    const nonExistentIdRes = await fetch(`${BASE_URL}/documents/507f1f77bcf86cd799439011/conflicts`);
    assert.strictEqual(nonExistentIdRes.status, 404);
    const nonExistentData = await nonExistentIdRes.json();
    assert(nonExistentData.error, 'Error message must be present for 404');
    console.log('  ✓ Pass: Invalid and missing documents return expected 400 / 404 error payloads.\n');

    console.log('====================================================');
    console.log('All Upload & Review Page API Flow Tests Passed!');
    console.log('====================================================\n');
  } finally {
    // Clean up
    if (uploadedDocId) {
      const mongoose = require('mongoose');
      const Document = require('./models/Document');
      if (mongoose.connection.readyState !== 1) {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/digibhoomi');
      }
      await Document.findByIdAndDelete(uploadedDocId);
      await mongoose.disconnect();
    }
  }
}

testUploadAndReviewFlow().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
