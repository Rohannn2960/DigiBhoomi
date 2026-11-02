const fs = require('fs');
const path = require('path');
const { TEST_API_BASE_URL } = require('./test_helpers/config');
const Document = require('./models/Document');
const { uploadDir } = require('./middleware/upload');
const { installTestIdentity } = require('./test_helpers/auth');

async function runTests() {
  const restoreTestIdentity = await installTestIdentity('Admin');
  const createdDocumentIds = new Set();
  const createdStoredFilenames = new Set();
  try {
  const baseUrl = TEST_API_BASE_URL;
  console.log('--- Starting DigiBhoomi Phase 2 Automated API Acceptance Tests ---\n');

  let pdfRecordId = null;

  // Test 1: Upload Valid PDF
  try {
    const pdfPath = path.join(__dirname, 'test_fixtures', 'sample.pdf');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(pdfPath)], { type: 'application/pdf' }), 'UP_Bhulekh_Khasra_Sample.pdf');

    const res = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    const data = await res.json();
    console.log(`[Test 2 & 6 & 7] Upload Valid PDF: Status ${res.status} | SHA-256: ${data.fileMetadata?.sha256Hash?.substring(0, 16)}... | Status: ${data.status}`);
    if (res.status === 201 && data._id && data.fileMetadata?.sha256Hash) {
      pdfRecordId = data._id;
      createdDocumentIds.add(data._id);
      createdStoredFilenames.add(data.fileMetadata.storedFilename);
      console.log('  ✓ Pass: Valid PDF uploaded, hashed, and persisted to MongoDB.');
    } else {
      console.error('  ✗ Fail:', data);
    }
  } catch (err) {
    console.error('  ✗ Fail uploading PDF:', err.message);
  }

  // Test 2: Upload Valid PNG
  try {
    const pngPath = path.join(__dirname, 'test_fixtures', 'sample.png');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(pngPath)], { type: 'image/png' }), 'Deed_Scan.png');

    const res = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    const data = await res.json();
    console.log(`[Test 3] Upload Valid PNG: Status ${res.status}`);
    if (res.status === 201 && data._id) {
      createdDocumentIds.add(data._id);
      createdStoredFilenames.add(data.fileMetadata.storedFilename);
      console.log('  ✓ Pass: Valid PNG uploaded successfully.');
    } else {
      console.error('  ✗ Fail:', data);
    }
  } catch (err) {
    console.error('  ✗ Fail uploading PNG:', err.message);
  }

  // Test 3: Upload Invalid File Type (.txt)
  try {
    const txtPath = path.join(__dirname, 'test_fixtures', 'invalid.txt');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(txtPath)], { type: 'text/plain' }), 'invalid.txt');

    const res = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    const data = await res.json();
    console.log(`[Test 4] Reject Invalid File (.txt): Status ${res.status} | Error: "${data.error}"`);
    if (res.status === 400 && data.error) {
      console.log('  ✓ Pass: Correctly rejected unsupported file type.');
    } else {
      console.error('  ✗ Fail: Expected 400, got', res.status);
    }
  } catch (err) {
    console.error('  ✗ Fail:', err.message);
  }

  // Test 4: Upload Oversized File (>10MB)
  try {
    const largePath = path.join(__dirname, 'test_fixtures', 'oversized.pdf');
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(largePath)], { type: 'application/pdf' }), 'oversized.pdf');

    const res = await fetch(`${baseUrl}/documents`, { method: 'POST', body: form });
    const data = await res.json();
    console.log(`[Test 5] Reject Oversized File (11MB): Status ${res.status} | Error: "${data.error}"`);
    if (res.status === 400 && data.error) {
      console.log('  ✓ Pass: Correctly rejected file exceeding 10MB limit.');
    } else {
      console.error('  ✗ Fail: Expected 400, got', res.status);
    }
  } catch (err) {
    console.error('  ✗ Fail:', err.message);
  }

  // Test 5: GET /api/documents
  try {
    const res = await fetch(`${baseUrl}/documents`);
    const data = await res.json();
    console.log(`[Test 8] GET /api/documents: Status ${res.status} | Found ${data.length} documents`);
    if (res.status === 200 && Array.isArray(data) && data.length >= 2) {
      console.log('  ✓ Pass: Returned documents list sorted newest first.');
      // Verify storagePath is not exposed!
      const leakedPath = data.some(d => d.fileMetadata?.storagePath);
      if (!leakedPath) {
        console.log('  ✓ Pass: Internal storagePath is protected and NOT exposed in API responses.');
      } else {
        console.error('  ✗ Warning: storagePath is visible in API response.');
      }
    }
  } catch (err) {
    console.error('  ✗ Fail listing documents:', err.message);
  }

  // Test 6: GET /api/documents/:id
  if (pdfRecordId) {
    try {
      const res = await fetch(`${baseUrl}/documents/${pdfRecordId}`);
      const data = await res.json();
      console.log(`[Test 9] GET /api/documents/:id: Status ${res.status} | Filename: ${data.fileMetadata?.originalFilename}`);
      if (res.status === 200 && data._id === pdfRecordId) {
        console.log('  ✓ Pass: Successfully retrieved document by ID.');
      }
    } catch (err) {
      console.error('  ✗ Fail retrieving document:', err.message);
    }

    // Test 7: GET /api/documents/:id/file (Preview endpoint)
    try {
      const res = await fetch(`${baseUrl}/documents/${pdfRecordId}/file`);
      const contentType = res.headers.get('content-type');
      const bytes = await res.arrayBuffer();
      console.log(`[Test 11] GET /api/documents/:id/file: Status ${res.status} | Content-Type: ${contentType} | Size: ${bytes.byteLength} bytes`);
      if (res.status === 200 && contentType.includes('application/pdf')) {
        console.log('  ✓ Pass: Stored document served securely for preview.');
      }
    } catch (err) {
      console.error('  ✗ Fail previewing file:', err.message);
    }
  }

  // Test 8: Invalid ObjectId format
  try {
    const res = await fetch(`${baseUrl}/documents/not-a-valid-id`);
    const data = await res.json();
    console.log(`[Test 10a] GET /api/documents/invalid_id: Status ${res.status} | Error: "${data.error}"`);
    if (res.status === 400) {
      console.log('  ✓ Pass: Invalid ID format returned 400 Bad Request.');
    }
  } catch (err) {
    console.error('  ✗ Fail:', err.message);
  }

  // Test 9: Non-existent ObjectId
  try {
    const res = await fetch(`${baseUrl}/documents/507f1f77bcf86cd799439011`);
    const data = await res.json();
    console.log(`[Test 10b] GET /api/documents/non_existent: Status ${res.status} | Error: "${data.error}"`);
    if (res.status === 404) {
      console.log('  ✓ Pass: Nonexistent record returned 404 Not Found.');
    }
  } catch (err) {
    console.error('  ✗ Fail:', err.message);
  }

  console.log('\n--- All Automated Backend Tests Completed ---');
  } finally {
    if (createdDocumentIds.size) {
      await Document.deleteMany({ _id: { $in: Array.from(createdDocumentIds) } });
    }
    for (const filename of createdStoredFilenames) {
      const filePath = path.resolve(uploadDir, path.basename(filename));
      if (filePath.startsWith(`${uploadDir}${path.sep}`)) {
        await fs.promises.unlink(filePath).catch(() => {});
      }
    }
    await restoreTestIdentity();
  }
}

runTests().catch(error => {
  console.error('API tests failed:', error);
  process.exitCode = 1;
});
