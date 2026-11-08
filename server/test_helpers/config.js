const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const {
  validateTestMongoUri,
  validateTestUploadDir,
  DEFAULT_TEST_MONGODB_URI,
  DEFAULT_TEST_UPLOAD_DIR
} = require('./isolation');

const serverRootDir = path.resolve(__dirname, '..');

const TEST_MONGODB_URI = process.env.RBAC_TEST_MONGODB_URI || DEFAULT_TEST_MONGODB_URI;
validateTestMongoUri(TEST_MONGODB_URI);

const TEST_UPLOAD_DIR = process.env.RBAC_TEST_UPLOAD_DIR || DEFAULT_TEST_UPLOAD_DIR;
validateTestUploadDir(serverRootDir, TEST_UPLOAD_DIR);

const TEST_API_BASE_URL = process.env.RBAC_TEST_API_URL || 'http://127.0.0.1:5001/api';
const testApiUrl = new URL(TEST_API_BASE_URL);
if (!['localhost', '127.0.0.1'].includes(testApiUrl.hostname) || testApiUrl.port !== '5001' || testApiUrl.pathname !== '/api') {
  throw new Error('Integration tests may only call the local test API on port 5001.');
}
const TEST_API_ORIGIN = testApiUrl.origin;

process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGODB_URI = TEST_MONGODB_URI;
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;

module.exports = {
  TEST_API_BASE_URL,
  TEST_API_ORIGIN,
  TEST_MONGODB_URI,
  TEST_UPLOAD_DIR
};