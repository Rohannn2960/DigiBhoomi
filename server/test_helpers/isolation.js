const path = require('path');
const fs = require('fs');

const ALLOWED_TEST_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const ALLOWED_TEST_PORT = '5001';
const DEFAULT_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/digibhoomi_rbac_test';
const DEFAULT_TEST_UPLOAD_DIR = 'uploads_rbac_test';
const DEFAULT_PROD_MONGODB_URI = 'mongodb://localhost:27017/digibhoomi';
const DEFAULT_PROD_UPLOAD_DIR = 'uploads';

/**
 * Resolves the real path of an existing path or the existing ancestor prefix of an uncreated path,
 * without creating any new files or directories on disk.
 * @param {string} p
 * @returns {string}
 */
function resolveRealPathSafely(p) {
  try {
    if (fs.existsSync(p)) {
      return fs.realpathSync(p);
    }
    const parts = [];
    let curr = path.resolve(p);
    while (!fs.existsSync(curr) && curr !== path.dirname(curr)) {
      parts.unshift(path.basename(curr));
      curr = path.dirname(curr);
    }
    if (fs.existsSync(curr)) {
      return path.resolve(fs.realpathSync(curr), ...parts);
    }
  } catch {
    // Fall back to resolved path if realpath fails
  }
  return path.resolve(p);
}

/**
 * Checks whether a relative path representation traverses to a parent directory.
 * Must match component boundaries: '..' exactly or starting with '..' + separator.
 * A path component beginning with two dots, such as '..test', is NOT a parent traversal.
 * @param {string} rel
 * @returns {boolean}
 */
function isParentTraversal(rel) {
  return rel === '..' || rel.startsWith(`..${path.sep}`);
}

/**
 * Determines relationship between two directories:
 * - 'equal' if same directory
 * - 'descendant' if targetDir is inside baseDir
 * - 'ancestor' if targetDir is an ancestor of baseDir
 * - 'disjoint' otherwise
 * @param {string} baseDir
 * @param {string} targetDir
 * @returns {'equal' | 'descendant' | 'ancestor' | 'disjoint'}
 */
function getPathRelation(baseDir, targetDir) {
  const relFromBase = path.relative(baseDir, targetDir);
  if (relFromBase === '') return 'equal';
  if (!isParentTraversal(relFromBase) && !path.isAbsolute(relFromBase)) {
    return 'descendant';
  }

  const relFromTarget = path.relative(targetDir, baseDir);
  if (relFromTarget === '') return 'equal';
  if (!isParentTraversal(relFromTarget) && !path.isAbsolute(relFromTarget)) {
    return 'ancestor';
  }

  return 'disjoint';
}

/**
 * Validates that a MongoDB URI is safe for testing:
 * - Must be a valid URL
 * - Host must be local (localhost, 127.0.0.1, [::1])
 * - Database name must end in _test
 * @param {string} uri
 */
function validateTestMongoUri(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('[Test Environment Error] MongoDB URI is required in test mode.');
  }

  let mongoUrl;
  try {
    mongoUrl = new URL(uri);
  } catch (err) {
    throw new Error(`[Test Environment Error] Invalid test MongoDB URI "${uri}": ${err.message}`);
  }

  if (mongoUrl.protocol !== 'mongodb:') {
    throw new Error(
      `[Test Environment Error] Tests require the "mongodb:" protocol. ` +
      `Received protocol "${mongoUrl.protocol}" in URI: "${uri}".`
    );
  }

  if (!ALLOWED_TEST_HOSTS.includes(mongoUrl.hostname)) {
    throw new Error(
      `[Test Environment Error] Tests may only connect to a local MongoDB server (localhost, 127.0.0.1, [::1]). ` +
      `Received host "${mongoUrl.hostname}" in URI: "${uri}".`
    );
  }

  const rawDb = mongoUrl.pathname.replace(/^\//, '').split('?')[0].split('/')[0];
  if (!rawDb || !rawDb.toLowerCase().endsWith('_test')) {
    throw new Error(
      `[Test Environment Error] Tests require a MongoDB database name ending in "_test". ` +
      `Received database "${rawDb || '(empty)'}" in URI: "${uri}".`
    );
  }

  return uri;
}

/**
 * Validates that the test upload directory is strictly isolated:
 * - Must not be equal to the normal/production uploads directory
 * - Must not be inside the normal/production uploads directory
 * - Must not be an ancestor of the normal/production uploads directory
 * - Must not resolve via symlink to any of the above
 * - Directory name must include "test"
 * @param {string} serverRootDir - Absolute path to server root directory
 * @param {string} uploadDir - Relative or absolute directory path
 */
function validateTestUploadDir(serverRootDir, uploadDir) {
  const normalUploadDir = path.resolve(serverRootDir, DEFAULT_PROD_UPLOAD_DIR);
  const resolvedTestDir = path.resolve(serverRootDir, uploadDir || DEFAULT_TEST_UPLOAD_DIR);

  // 1. Check resolved paths relationship
  const resolvedRelation = getPathRelation(normalUploadDir, resolvedTestDir);
  if (resolvedRelation === 'equal') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot resolve to the normal uploads directory ("${normalUploadDir}"). ` +
      `Received: "${uploadDir}".`
    );
  }
  if (resolvedRelation === 'descendant') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot be inside the normal uploads directory ("${normalUploadDir}"). ` +
      `Received: "${uploadDir}" (resolves to "${resolvedTestDir}").`
    );
  }
  if (resolvedRelation === 'ancestor') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot be an ancestor of the normal uploads directory ("${normalUploadDir}"). ` +
      `Received: "${uploadDir}" (resolves to "${resolvedTestDir}").`
    );
  }

  // 2. Check real paths relationship (resolves existing symlinks / junctions without creating uncreated dirs)
  const realNormal = resolveRealPathSafely(normalUploadDir);
  const realTest = resolveRealPathSafely(resolvedTestDir);

  const realRelation = getPathRelation(realNormal, realTest);
  if (realRelation === 'equal') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot resolve via symlink to the normal uploads directory ("${realNormal}"). ` +
      `Received: "${uploadDir}" (real path "${realTest}").`
    );
  }
  if (realRelation === 'descendant') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot resolve via symlink to inside the normal uploads directory ("${realNormal}"). ` +
      `Received: "${uploadDir}" (real path "${realTest}").`
    );
  }
  if (realRelation === 'ancestor') {
    throw new Error(
      `[Test Environment Error] Test upload directory cannot resolve via symlink to an ancestor of the normal uploads directory ("${realNormal}"). ` +
      `Received: "${uploadDir}" (real path "${realTest}").`
    );
  }

  // 3. Basename check: directory name must include "test"
  const baseName = path.basename(resolvedTestDir).toLowerCase();
  if (!baseName.includes('test')) {
    throw new Error(
      `[Test Environment Error] Tests require a separate upload directory whose name includes "test". ` +
      `Received: "${uploadDir}" (resolves to "${resolvedTestDir}").`
    );
  }

  return resolvedTestDir;
}

/**
 * Configures and validates environment variables for test vs dev/prod mode.
 * In test mode:
 * - Rejects any explicitly conflicting port other than 5001 with a clear error
 * - Forces port 5001
 * - process.env.MONGODB_URI is ALWAYS overwritten from RBAC_TEST_MONGODB_URI or default test URI
 * - Never trusts pre-existing MONGODB_URI
 * - Validates local host and _test DB suffix
 * - Overwrites UPLOAD_DIR with RBAC_TEST_UPLOAD_DIR or default test upload dir
 * - Validates upload dir is not equal to, inside, or ancestor of normal uploads, and contains "test"
 * In dev/prod mode:
 * - Preserves existing behavior, custom ports, and defaults without throwing
 * @param {object} env - Environment object (defaults to process.env)
 * @param {string} serverRootDir - Server root path (defaults to server directory)
 */
function configureTestEnvironment(env = process.env, serverRootDir = path.resolve(__dirname, '..')) {
  const isTestMode = env.NODE_ENV === 'test' || String(env.PORT) === ALLOWED_TEST_PORT;

  if (!isTestMode) {
    return {
      isTestMode: false,
      port: env.PORT || 5000,
      mongoUri: env.MONGODB_URI || DEFAULT_PROD_MONGODB_URI,
      uploadDir: env.UPLOAD_DIR || DEFAULT_PROD_UPLOAD_DIR
    };
  }

  // In test mode: reject an explicitly conflicting port
  if (env.PORT && String(env.PORT) !== ALLOWED_TEST_PORT) {
    throw new Error(
      `[Test Environment Error] Tests may only run on port ${ALLOWED_TEST_PORT}. ` +
      `Received conflicting port: "${env.PORT}".`
    );
  }

  env.NODE_ENV = 'test';
  env.PORT = ALLOWED_TEST_PORT;

  // In test mode, derive MONGODB_URI exclusively from RBAC_TEST_MONGODB_URI or default test URI
  // DO NOT trust pre-existing MONGODB_URI
  const testMongoUri = env.RBAC_TEST_MONGODB_URI || DEFAULT_TEST_MONGODB_URI;
  validateTestMongoUri(testMongoUri);
  env.MONGODB_URI = testMongoUri;

  // In test mode, derive UPLOAD_DIR exclusively from RBAC_TEST_UPLOAD_DIR or default test upload dir
  // DO NOT trust pre-existing UPLOAD_DIR
  const testUploadDir = env.RBAC_TEST_UPLOAD_DIR || DEFAULT_TEST_UPLOAD_DIR;
  validateTestUploadDir(serverRootDir, testUploadDir);
  env.UPLOAD_DIR = testUploadDir;

  return {
    isTestMode: true,
    port: env.PORT,
    mongoUri: env.MONGODB_URI,
    uploadDir: env.UPLOAD_DIR
  };
}

module.exports = {
  ALLOWED_TEST_HOSTS,
  ALLOWED_TEST_PORT,
  DEFAULT_TEST_MONGODB_URI,
  DEFAULT_TEST_UPLOAD_DIR,
  DEFAULT_PROD_MONGODB_URI,
  DEFAULT_PROD_UPLOAD_DIR,
  validateTestMongoUri,
  validateTestUploadDir,
  configureTestEnvironment,
  getPathRelation,
  isParentTraversal
};
