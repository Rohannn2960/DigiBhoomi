const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  validateTestMongoUri,
  validateTestUploadDir,
  configureTestEnvironment,
  getPathRelation,
  isParentTraversal,
  ALLOWED_TEST_PORT,
  DEFAULT_TEST_MONGODB_URI,
  DEFAULT_TEST_UPLOAD_DIR,
  DEFAULT_PROD_MONGODB_URI,
  DEFAULT_PROD_UPLOAD_DIR
} = require('./test_helpers/isolation');

const SERVER_ROOT = path.resolve(__dirname);
const SERVER_SCRIPT = path.join(SERVER_ROOT, 'server.js');
const SPY_SCRIPT = path.join(SERVER_ROOT, 'test_helpers', 'startup_spy.js');

console.log('====================================================');
console.log('   DigiBhoomi Test Database & Upload Isolation Tests');
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

// ============================================================================
// SUITE 1: Port Enforcement
// ============================================================================
runTest('Unit: Test mode rejects explicitly conflicting port (PORT=5000)', () => {
  const env = { NODE_ENV: 'test', PORT: '5000' };
  assert.throws(
    () => configureTestEnvironment(env, SERVER_ROOT),
    (err) => {
      return /Tests may only run on port 5001/i.test(err.message) &&
             /conflicting port: "5000"/i.test(err.message);
    }
  );
});

runTest('Unit: Test mode rejects arbitrary conflicting port (PORT=8080)', () => {
  const env = { NODE_ENV: 'test', PORT: '8080' };
  assert.throws(
    () => configureTestEnvironment(env, SERVER_ROOT),
    (err) => {
      return /Tests may only run on port 5001/i.test(err.message) &&
             /conflicting port: "8080"/i.test(err.message);
    }
  );
});

runTest('Unit: Test mode forces port 5001 when port is unassigned', () => {
  const env = { NODE_ENV: 'test' };
  const result = configureTestEnvironment(env, SERVER_ROOT);
  assert.equal(result.isTestMode, true);
  assert.equal(env.PORT, ALLOWED_TEST_PORT);
  assert.equal(result.port, ALLOWED_TEST_PORT);
});

runTest('Unit: Normal development mode allows port 5000 or custom dev ports', () => {
  const devEnv = { NODE_ENV: 'development', PORT: '3000' };
  const result = configureTestEnvironment(devEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, false);
  assert.equal(devEnv.PORT, '3000');
  assert.equal(result.port, '3000');
});

runTest('Process: server.js aborts immediately with clear error on conflicting test port', () => {
  const proc = spawnSync(
    process.execPath,
    [SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5000'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(proc.status, 0, 'server.js must exit non-zero on conflicting test port');
  const combined = `${proc.stdout}\n${proc.stderr}`;
  assert.match(combined, /Tests may only run on port 5001/i);
});

// ============================================================================
// SUITE 2: Pre-existing production MONGODB_URI in test mode
// ============================================================================
runTest('Unit: NODE_ENV=test overrides pre-existing production MONGODB_URI', () => {
  const customEnv = {
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/digibhoomi',
    PORT: '5001'
  };

  const result = configureTestEnvironment(customEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, true);
  assert.equal(
    customEnv.MONGODB_URI,
    DEFAULT_TEST_MONGODB_URI,
    'pre-existing production MONGODB_URI must be ignored and replaced with test DB URI'
  );
  assert.equal(result.mongoUri, DEFAULT_TEST_MONGODB_URI);
  assert.equal(customEnv.UPLOAD_DIR, DEFAULT_TEST_UPLOAD_DIR);
});

runTest('Unit: NODE_ENV=test honors custom valid RBAC_TEST_MONGODB_URI over pre-existing MONGODB_URI', () => {
  const customEnv = {
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://localhost:27017/digibhoomi',
    RBAC_TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/my_custom_isolated_test',
    PORT: '5001'
  };

  const result = configureTestEnvironment(customEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, true);
  assert.equal(customEnv.MONGODB_URI, 'mongodb://127.0.0.1:27017/my_custom_isolated_test');
  assert.notEqual(customEnv.MONGODB_URI, 'mongodb://localhost:27017/digibhoomi');
});

runTest('Process: server.js genuine startup overrides production MONGODB_URI before DB connection and listener', () => {
  // Genuinely executes server.js via node with test_helpers/startup_spy.js preloaded
  // The spy hooks mongoose.connect to inspect the URI passed by server.js and exits with 0
  // before opening any database sockets or starting the HTTP listener.
  const proc = spawnSync(
    process.execPath,
    ['-r', SPY_SCRIPT, SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5001',
        MONGODB_URI: 'mongodb://localhost:27017/digibhoomi'
      },
      encoding: 'utf8'
    }
  );

  assert.equal(proc.status, 0, `server.js execution failed: ${proc.stderr}`);
  const match = proc.stdout.match(/HOOKED_URI:(.+)/);
  assert.ok(match, `Expected HOOKED_URI in stdout. Got: ${proc.stdout}`);
  const capturedUri = match[1].trim();
  assert.equal(
    capturedUri,
    DEFAULT_TEST_MONGODB_URI,
    'server.js must supply test database URI to mongoose.connect, not production URI'
  );
  assert.notEqual(capturedUri, 'mongodb://localhost:27017/digibhoomi');
});

// ============================================================================
// SUITE 3: MongoDB URI Protocol and Remote Host Validation
// ============================================================================
runTest('Unit: validateTestMongoUri requires "mongodb:" protocol and rejects https:, http:, ftp:, mongodb+srv:', () => {
  const invalidProtocols = [
    'https://localhost:27017/digibhoomi_test',
    'http://localhost:27017/digibhoomi_test',
    'ftp://localhost:27017/digibhoomi_test',
    'mongodb+srv://localhost/digibhoomi_test'
  ];

  for (const uri of invalidProtocols) {
    assert.throws(
      () => validateTestMongoUri(uri),
      (err) => {
        return /Tests require the "mongodb:" protocol/i.test(err.message);
      },
      `Should reject protocol in "${uri}"`
    );
  }
});

runTest('Process: server.js aborts immediately when RBAC_TEST_MONGODB_URI uses invalid protocol (https:)', () => {
  const proc = spawnSync(
    process.execPath,
    [SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5001',
        RBAC_TEST_MONGODB_URI: 'https://localhost:27017/digibhoomi_test'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(proc.status, 0, 'server.js must exit non-zero on non-mongodb protocol');
  const combined = `${proc.stdout}\n${proc.stderr}`;
  assert.match(combined, /Tests require the "mongodb:" protocol/i);
});

runTest('Unit: validateTestMongoUri rejects remote database host', () => {
  assert.throws(
    () => validateTestMongoUri('mongodb://remote-db.example.com:27017/digibhoomi_test'),
    (err) => {
      return /Tests may only connect to a local MongoDB server/i.test(err.message) &&
             /remote-db\.example\.com/i.test(err.message);
    }
  );
});

runTest('Process: server.js aborts immediately with error when RBAC_TEST_MONGODB_URI is remote', () => {
  const proc = spawnSync(
    process.execPath,
    [SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5001',
        RBAC_TEST_MONGODB_URI: 'mongodb://remote-cluster.internal:27017/digibhoomi_test'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(proc.status, 0, 'server.js must exit non-zero on remote test MongoDB URI');
  const combinedOutput = `${proc.stdout}\n${proc.stderr}`;
  assert.match(combinedOutput, /Tests may only connect to a local MongoDB server/i);
});

// ============================================================================
// SUITE 4: Database name without _test
// ============================================================================
runTest('Unit: validateTestMongoUri rejects database without _test suffix', () => {
  assert.throws(
    () => validateTestMongoUri('mongodb://127.0.0.1:27017/digibhoomi_production'),
    (err) => {
      return /Tests require a MongoDB database name ending in "_test"/i.test(err.message) &&
             /digibhoomi_production/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestMongoUri rejects primary digibhoomi database name', () => {
  assert.throws(
    () => validateTestMongoUri('mongodb://localhost:27017/digibhoomi'),
    (err) => {
      return /Tests require a MongoDB database name ending in "_test"/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestMongoUri rejects URI with missing database name', () => {
  assert.throws(
    () => validateTestMongoUri('mongodb://127.0.0.1:27017/'),
    (err) => {
      return /Tests require a MongoDB database name ending in "_test"/i.test(err.message);
    }
  );
});

runTest('Process: server.js aborts immediately when test database does not end in _test', () => {
  const proc = spawnSync(
    process.execPath,
    [SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5001',
        RBAC_TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/digibhoomi_production'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(proc.status, 0, 'server.js must exit non-zero when DB does not end in _test');
  const combinedOutput = `${proc.stdout}\n${proc.stderr}`;
  assert.match(combinedOutput, /Tests require a MongoDB database name ending in "_test"/i);
});

// ============================================================================
// SUITE 5: Strengthened Upload Directory Isolation & Path Relationship Detection
// ============================================================================
runTest('Unit: isParentTraversal accurately distinguishes parent traversal from double-dot component names', () => {
  // Actual parent traversal
  assert.equal(isParentTraversal('..'), true);
  assert.equal(isParentTraversal(`..${path.sep}some_path`), true);

  // Path components starting with double dots must NOT be parent traversals
  assert.equal(isParentTraversal('..test'), false);
  assert.equal(isParentTraversal(`..test${path.sep}sub`), false);
  assert.equal(isParentTraversal(`subfolder${path.sep}..test`), false);

  // Platform-appropriate backslash handling: on POSIX, backslash is not treated as a path separator
  if (process.platform === 'win32') {
    assert.equal(isParentTraversal('..\\some_path'), true);
  } else {
    assert.equal(isParentTraversal('..\\some_path'), false);
  }
});

runTest('Unit: validateTestUploadDir rejects directory equal to normal uploads directory', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'uploads'),
    (err) => {
      return /Test upload directory cannot resolve to the normal uploads directory/i.test(err.message);
    }
  );

  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, './uploads'),
    (err) => {
      return /Test upload directory cannot resolve to the normal uploads directory/i.test(err.message);
    }
  );

  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'UPLOADS'),
    (err) => {
      return /Test upload directory cannot resolve to the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects test directory inside normal uploads (uploads/test)', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'uploads/test'),
    (err) => {
      return /Test upload directory cannot be inside the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects nested directory inside normal uploads (uploads/subfolder/test)', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'uploads/subfolder/test'),
    (err) => {
      return /Test upload directory cannot be inside the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects double-dot prefix directory inside normal uploads (uploads/..test)', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'uploads/..test'),
    (err) => {
      return /Test upload directory cannot be inside the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects nested double-dot directory inside normal uploads (uploads/subfolder/..test)', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'uploads/subfolder/..test'),
    (err) => {
      return /Test upload directory cannot be inside the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects test-named parent directory containing normal uploads', () => {
  // Create a synthetic server directory structure in memory: normal upload is serverRootDir/uploads
  // A test directory that is an ancestor of normal uploads must be rejected
  const fakeServerRootDir = path.resolve(SERVER_ROOT, 'test_fake_subsystem', 'server');
  const fakeAncestorTestDir = path.resolve(SERVER_ROOT, 'test_fake_subsystem');

  assert.throws(
    () => validateTestUploadDir(fakeServerRootDir, fakeAncestorTestDir),
    (err) => {
      return /Test upload directory cannot be an ancestor of the normal uploads directory/i.test(err.message);
    }
  );
});

runTest('Unit: validateTestUploadDir rejects symlink/junction into normal uploads directory', () => {
  const normalDir = path.resolve(SERVER_ROOT, 'uploads');
  const linkDir = path.resolve(SERVER_ROOT, 'test_junction_symlink_upload');

  try {
    // Attempt to create a junction (supported without admin on Windows)
    fs.symlinkSync(normalDir, linkDir, 'junction');
  } catch (err) {
    console.log(`    (Symlink/junction creation unsupported on platform: ${err.message}; skipped)`);
    return;
  }

  try {
    assert.throws(
      () => validateTestUploadDir(SERVER_ROOT, 'test_junction_symlink_upload'),
      (err) => {
        return /Test upload directory cannot resolve via symlink to the normal uploads directory/i.test(err.message);
      }
    );
  } finally {
    try {
      fs.unlinkSync(linkDir);
    } catch {}
  }
});

runTest('Unit: validateTestUploadDir permits valid sibling directories (uploads_rbac_test)', () => {
  const result = validateTestUploadDir(SERVER_ROOT, 'uploads_rbac_test');
  assert.equal(result, path.resolve(SERVER_ROOT, 'uploads_rbac_test'));
});

runTest('Unit: validateTestUploadDir rejects directory without "test" in name', () => {
  assert.throws(
    () => validateTestUploadDir(SERVER_ROOT, 'custom_temporary_folder'),
    (err) => {
      return /Tests require a separate upload directory whose name includes "test"/i.test(err.message);
    }
  );
});

runTest('Process: server.js aborts immediately when test upload directory is set to uploads', () => {
  const proc = spawnSync(
    process.execPath,
    [SERVER_SCRIPT],
    {
      cwd: SERVER_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: '5001',
        RBAC_TEST_UPLOAD_DIR: 'uploads'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(proc.status, 0, 'server.js must exit non-zero when test upload dir is uploads');
  const combinedOutput = `${proc.stdout}\n${proc.stderr}`;
  assert.match(combinedOutput, /Test upload directory cannot resolve to the normal uploads directory/i);
});

// ============================================================================
// SUITE 6: Normal Development and Production Mode Preservation
// ============================================================================
runTest('Unit: Normal development mode does not alter dev database or upload defaults', () => {
  const devEnv = {
    NODE_ENV: 'development',
    PORT: '5000',
    MONGODB_URI: 'mongodb://localhost:27017/digibhoomi',
    UPLOAD_DIR: 'uploads'
  };

  const result = configureTestEnvironment(devEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, false);
  assert.equal(devEnv.MONGODB_URI, 'mongodb://localhost:27017/digibhoomi');
  assert.equal(devEnv.UPLOAD_DIR, 'uploads');
  assert.equal(devEnv.PORT, '5000');
  assert.equal(result.mongoUri, 'mongodb://localhost:27017/digibhoomi');
  assert.equal(result.uploadDir, 'uploads');
});

runTest('Unit: Normal development mode with undefined variables sets standard defaults without throwing', () => {
  const devEnv = {};

  const result = configureTestEnvironment(devEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, false);
  assert.equal(result.port, 5000);
  assert.equal(result.mongoUri, DEFAULT_PROD_MONGODB_URI);
  assert.equal(result.uploadDir, DEFAULT_PROD_UPLOAD_DIR);
});

runTest('Unit: Normal production mode allows custom remote MongoDB URIs without test restrictions', () => {
  const prodEnv = {
    NODE_ENV: 'production',
    PORT: '8080',
    MONGODB_URI: 'mongodb+srv://prod-user:secret@cluster0.digibhoomi.mongodb.net/digibhoomi_prod',
    UPLOAD_DIR: '/var/data/digibhoomi/uploads'
  };

  const result = configureTestEnvironment(prodEnv, SERVER_ROOT);
  assert.equal(result.isTestMode, false);
  assert.equal(prodEnv.MONGODB_URI, 'mongodb+srv://prod-user:secret@cluster0.digibhoomi.mongodb.net/digibhoomi_prod');
  assert.equal(prodEnv.UPLOAD_DIR, '/var/data/digibhoomi/uploads');
  assert.equal(result.port, '8080');
});

console.log('\n====================================================');
console.log(`Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
console.log('====================================================\n');

if (failed > 0) {
  process.exitCode = 1;
}
