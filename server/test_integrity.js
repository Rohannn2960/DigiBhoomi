const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');

const Document = require('./models/Document');
const { uploadDir } = require('./middleware/upload');
const { installTestIdentity } = require('./test_helpers/auth');
const BASE_URL = TEST_API_BASE_URL;
const FIXTURE_PATH = path.join(__dirname, 'test_fixtures', 'english_record.png');

async function requestIntegrity(id) {
  const response = await fetch(`${BASE_URL}/documents/${id}/integrity`);
  return { response, data: await response.json() };
}

async function runTests() {
  let documentId;
  let storedFilePath;
  let backupFilePath;
  let originalBytes;
  let restoreTestIdentity;

  await mongoose.connect(TEST_MONGODB_URI);
  restoreTestIdentity = await installTestIdentity('Admin');

  try {
    const fixtureBytes = await fs.promises.readFile(FIXTURE_PATH);
    const formData = new FormData();
    formData.append('file', new Blob([fixtureBytes], { type: 'image/png' }), 'integrity-test.png');

    const uploadResponse = await fetch(`${BASE_URL}/documents`, { method: 'POST', body: formData });
    const uploaded = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201, 'upload should succeed');
    documentId = uploaded._id;

    const expectedHash = crypto.createHash('sha256').update(fixtureBytes).digest('hex');
    assert.equal(uploaded.fileMetadata.sha256Hash, expectedHash, 'upload should store the SHA-256 of original bytes');
    assert.equal(uploaded.fileMetadata.hashAlgorithm, 'SHA-256');
    assert.equal(Object.hasOwn(uploaded.fileMetadata, 'storagePath'), false, 'upload response must hide storage paths');
    console.log('PASS upload stores SHA-256 of original bytes');

    storedFilePath = path.resolve(uploadDir, path.basename(uploaded.fileMetadata.storedFilename));
    originalBytes = await fs.promises.readFile(storedFilePath);

    let result = await requestIntegrity(documentId);
    assert.equal(result.response.status, 200);
    assert.equal(result.data.status, 'INTEGRITY_VERIFIED');
    assert.equal(result.data.storedHash, expectedHash);
    assert.equal(result.data.calculatedHash, expectedHash);
    assert.ok(result.data.verifiedAt);
    assert.equal(Object.hasOwn(result.data, 'storagePath'), false);
    console.log('PASS unchanged document verifies');

    await fs.promises.writeFile(storedFilePath, Buffer.concat([originalBytes, Buffer.from('tampered')]));
    result = await requestIntegrity(documentId);
    assert.equal(result.data.status, 'INTEGRITY_FAILED');
    assert.notEqual(result.data.calculatedHash, expectedHash);
    const afterTampering = await Document.findById(documentId).lean();
    assert.equal(afterTampering.fileMetadata.sha256Hash, expectedHash, 'verification must not overwrite the stored baseline hash');
    await fs.promises.writeFile(storedFilePath, originalBytes);
    console.log('PASS modified document fails without overwriting the stored hash');

    backupFilePath = `${storedFilePath}.integrity-test-backup`;
    assert.equal(fs.existsSync(backupFilePath), false, 'test backup path must be unused');
    await fs.promises.rename(storedFilePath, backupFilePath);
    try {
      result = await requestIntegrity(documentId);
      assert.equal(result.data.status, 'HASH_UNAVAILABLE');
      assert.equal(result.data.calculatedHash, null);
    } finally {
      await fs.promises.rename(backupFilePath, storedFilePath);
      backupFilePath = null;
    }
    console.log('PASS missing original file returns HASH_UNAVAILABLE');

    await Document.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(documentId) },
      { $unset: { 'fileMetadata.sha256Hash': '' } }
    );
    result = await requestIntegrity(documentId);
    assert.equal(result.data.status, 'HASH_UNAVAILABLE');
    assert.equal(result.data.storedHash, null);
    assert.ok(result.data.calculatedHash, 'the current file hash may still be returned');
    const savedDocument = await Document.findById(documentId).lean();
    assert.equal(savedDocument.integrityVerification.status, 'HASH_UNAVAILABLE');
    assert.ok(savedDocument.integrityVerification.verifiedAt);
    console.log('PASS missing stored hash returns HASH_UNAVAILABLE and saves last result');

    result = await requestIntegrity(new mongoose.Types.ObjectId().toString());
    assert.equal(result.response.status, 404);
    console.log('PASS missing document returns 404');
  } finally {
    if (backupFilePath && fs.existsSync(backupFilePath)) {
      await fs.promises.rename(backupFilePath, storedFilePath);
    }
    if (documentId) {
      await Document.deleteOne({ _id: documentId });
    }
    if (storedFilePath && fs.existsSync(storedFilePath)) {
      await fs.promises.unlink(storedFilePath);
    }
    if (restoreTestIdentity) await restoreTestIdentity();
    await mongoose.disconnect();
  }
}

runTests().catch((error) => {
  console.error('Integrity tests failed:', error);
  process.exitCode = 1;
});