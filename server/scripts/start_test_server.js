#!/usr/bin/env node
/**
 * Standalone runner for DigiBhoomi isolated test backend.
 * Enforces test environment variables before launching server.js.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGODB_URI = process.env.RBAC_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/digibhoomi_rbac_test';
process.env.UPLOAD_DIR = process.env.RBAC_TEST_UPLOAD_DIR || 'uploads_rbac_test';

require('../server.js');
