const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const TEST_MONGODB_URI = process.env.RBAC_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/digibhoomi_rbac_test';
const mongoUrl = new URL(TEST_MONGODB_URI);
const databaseName = mongoUrl.pathname.replace(/^\//, '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(mongoUrl.hostname)) {
  throw new Error('Tests may only connect to a local MongoDB server.');
}
if (!databaseName.toLowerCase().endsWith('_test')) {
  throw new Error('Tests require a MongoDB database name ending in _test.');
}

const TEST_UPLOAD_DIR = process.env.RBAC_TEST_UPLOAD_DIR || 'uploads_rbac_test';
if (!path.basename(TEST_UPLOAD_DIR).toLowerCase().includes('test')) {
  throw new Error('Tests require a separate upload directory whose name includes "test".');
}

const TEST_API_BASE_URL = process.env.RBAC_TEST_API_URL || 'http://127.0.0.1:5001/api';
const testApiUrl = new URL(TEST_API_BASE_URL);
if (!['localhost', '127.0.0.1'].includes(testApiUrl.hostname) || testApiUrl.port !== '5001' || testApiUrl.pathname !== '/api') {
  throw new Error('Integration tests may only call the local test API on port 5001.');
}
const TEST_API_ORIGIN = testApiUrl.origin;

process.env.MONGODB_URI = TEST_MONGODB_URI;
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;

module.exports = {
  TEST_API_BASE_URL,
  TEST_API_ORIGIN,
  TEST_MONGODB_URI,
  TEST_UPLOAD_DIR
};