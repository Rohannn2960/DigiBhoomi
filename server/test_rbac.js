const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { TEST_API_BASE_URL, TEST_MONGODB_URI } = require('./test_helpers/config');

const User = require('./models/User');
const Document = require('./models/Document');
const Session = require('./models/Session');
const AuditEvent = require('./models/AuditEvent');
const { uploadDir } = require('./middleware/upload');
const { createRateLimiter } = require('./middleware/rateLimit');
const { cleanupTestIdentities, createTestIdentity, makeAuthenticatedFetch } = require('./test_helpers/auth');
const { ensureBootstrapAdmin } = require('./services/auth');

const API = TEST_API_BASE_URL;
const FIXTURE = path.join(__dirname, 'test_fixtures', 'english_record.png');
const identities = [];
const documentIds = [];
const storedFiles = [];

async function registerCitizen(label) {
  const email = `rbac-${label}-${crypto.randomUUID()}@example.test`;
  const password = `Citizen-test-${crypto.randomBytes(12).toString('hex')}!`;
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: `Test ${label}`, email, password, role: 'Admin' })
  });
  const data = await response.json();
  assert.equal(response.status, 201);
  assert.equal(data.user.role, 'Citizen', 'self-registration must ignore requested elevated roles');
  const cookie = (response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie')).split(';')[0];
  const user = await User.findById(data.user.id);
  identities.push({ user, cookie });
  return identities[identities.length - 1];
}

async function createUploadedDocument(fetcher, filename) {
  const bytes = await fs.promises.readFile(FIXTURE);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'image/png' }), filename);
  form.append('ownerId', new mongoose.Types.ObjectId().toString());
  const response = await fetcher(`${API}/documents`, { method: 'POST', body: form });
  const document = await response.json();
  assert.equal(response.status, 201, `upload ${filename} should succeed`);
  documentIds.push(document._id);
  storedFiles.push(path.resolve(uploadDir, path.basename(document.fileMetadata.storedFilename)));
  return document;
}

async function expectStatus(responsePromise, expected, message) {
  const response = await responsePromise;
  assert.equal(response.status, expected, message);
  return response;
}

async function run() {
  await mongoose.connect(TEST_MONGODB_URI);
  try {
    const unauthenticated = fetch;
    await expectStatus(unauthenticated(`${API}/documents`), 401, 'unauthenticated document listing must be blocked');
    await expectStatus(unauthenticated(`${API}/documents`, {
      headers: { 'x-user-id': '000000000000000000000001', 'x-user-role': 'Admin' }
    }), 401, 'client-supplied identity headers must not authenticate');
    console.log('PASS unauthenticated access and spoofed role headers are rejected');

    const failedLogin = await unauthenticated(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `missing-${crypto.randomUUID()}@example.test`, password: 'wrong-password-123!' })
    });
    assert.equal(failedLogin.status, 401);

    const csrfResponse = await unauthenticated(`${API}/auth/register`, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Blocked Origin', email: 'blocked@example.test', password: 'NeverCreated-Password-1!' })
    });
    assert.equal(csrfResponse.status, 403, 'untrusted browser origins must be blocked before auth actions');
    console.log('PASS cross-origin state-changing request is rejected');

    const limiter = createRateLimiter({ limit: 2, windowMs: 10000, action: 'TEST', audit: async () => {} });
    const invokeLimiter = () => new Promise(resolve => {
      const request = { ip: '192.0.2.77' };
      const response = {
        set() {},
        status(status) { this.statusCode = status; return this; },
        json(body) { resolve({ status: this.statusCode, body }); }
      };
      limiter(request, response, () => resolve({ status: 200 }));
    });
    assert.equal((await invokeLimiter()).status, 200);
    assert.equal((await invokeLimiter()).status, 200);
    assert.equal((await invokeLimiter()).status, 429);
    console.log('PASS login/registration limiter returns 429 after its configured threshold');

    const citizenA = await registerCitizen('citizen-a');
    const citizenB = await registerCitizen('citizen-b');
    const storedCitizen = await User.findById(citizenA.user._id).select('+passwordSalt +passwordHash');
    assert.ok(storedCitizen.passwordSalt.length >= 32);
    assert.equal(storedCitizen.passwordHash.length, 128);
    const sessionToken = citizenA.cookie.split('=')[1];
    const storedSession = await Session.findOne({ userId: citizenA.user._id }).select('+tokenHash');
    assert.equal(storedSession.tokenHash, crypto.createHash('sha256').update(sessionToken).digest('hex'));
    assert.notEqual(storedSession.tokenHash, sessionToken);
    console.log('PASS passwords use salted scrypt hashes and only session-token hashes are stored');
    const officerA = await createTestIdentity('Officer');
    const officerB = await createTestIdentity('Officer');
    const admin = await createTestIdentity('Admin');
    identities.push(officerA, officerB, admin);

    const citizenAFetch = makeAuthenticatedFetch(citizenA.cookie);
    const citizenBFetch = makeAuthenticatedFetch(citizenB.cookie);
    const officerAFetch = makeAuthenticatedFetch(officerA.cookie);
    const officerBFetch = makeAuthenticatedFetch(officerB.cookie);
    const adminFetch = makeAuthenticatedFetch(admin.cookie);

    const docA = await createUploadedDocument(citizenAFetch, 'citizen-a.png');
    const docB = await createUploadedDocument(citizenBFetch, 'citizen-b.png');
    assert.equal(docA.ownerId, citizenA.user._id.toString());
    assert.equal(docB.ownerId, citizenB.user._id.toString());
    assert.equal(docA.fileMetadata.hashAlgorithm, 'SHA-256');
    console.log('PASS citizens upload documents owned by their authenticated accounts');

    const ownDocument = await citizenAFetch(`${API}/documents/${docA._id}`);
    assert.equal(ownDocument.status, 200);
    const privateDocument = await citizenBFetch(`${API}/documents/${docA._id}`);
    assert.equal(privateDocument.status, 404);
    await expectStatus(citizenBFetch(`${API}/documents/${docA._id}/file`), 404, 'citizens cannot stream another user file');
    await expectStatus(citizenBFetch(`${API}/documents/${docA._id}/integrity`), 404, 'citizens cannot verify another user file');
    const citizenList = await (await citizenAFetch(`${API}/documents?role=Admin&ownerId=${citizenB.user._id}`)).json();
    assert.deepEqual(citizenList.map(document => document._id), [docA._id]);
    await expectStatus(citizenAFetch(`${API}/documents/${docA._id}`, { method: 'DELETE' }), 404, 'no document deletion route should be exposed');
    console.log('PASS citizens can only list and access their own documents');

    await expectStatus(citizenAFetch(`${API}/documents/${docA._id}/review`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' })
    }), 403, 'citizens cannot approve documents');
    await expectStatus(citizenAFetch(`${API}/users/${citizenA.user._id}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Admin' })
    }), 403, 'citizens cannot change their own roles');
    await expectStatus(citizenAFetch(`${API}/users`), 403, 'citizens cannot access user management');
    console.log('PASS citizen review, self-role changes, and admin APIs are denied');

    const expiredIdentity = await createTestIdentity('Citizen');
    identities.push(expiredIdentity);
    await Session.updateMany({ userId: expiredIdentity.user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await expectStatus(makeAuthenticatedFetch(expiredIdentity.cookie)(`${API}/documents`), 401, 'expired sessions must be rejected');
    const logoutIdentity = await createTestIdentity('Citizen');
    identities.push(logoutIdentity);
    const logoutFetch = makeAuthenticatedFetch(logoutIdentity.cookie);
    const logoutResponse = await logoutFetch(`${API}/auth/logout`, { method: 'POST' });
    assert.equal(logoutResponse.status, 204);
    await expectStatus(logoutFetch(`${API}/auth/me`), 401, 'logout must revoke the database session');
    console.log('PASS expired sessions are rejected and logout invalidates its session');

    await expectStatus(officerAFetch(`${API}/documents/${docA._id}`), 404, 'unassigned officers cannot access a citizen document');
    await expectStatus(adminFetch(`${API}/documents/${docA._id}/assignment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedOfficerId: officerA.user._id.toString() })
    }), 200, 'admin can assign a document to an active officer');
    const assignedDoc = await officerAFetch(`${API}/documents/${docA._id}`);
    assert.equal(assignedDoc.status, 200);
    await expectStatus(officerBFetch(`${API}/documents/${docA._id}`), 404, 'unassigned officers cannot access another officer’s assignment');
    const officerList = await (await officerAFetch(`${API}/documents`)).json();
    assert.deepEqual(officerList.map(document => document._id), [docA._id]);
    console.log('PASS officer access is restricted to explicit assignments');

    await Document.updateOne({ _id: docA._id }, { $set: { status: 'Needs review' } });
    const draftResponse = await officerAFetch(`${API}/documents/${docA._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', remarks: 'Checked source record', landDetails: { ownerName: { value: 'Reviewed owner' } } })
    });
    assert.equal(draftResponse.status, 200);
    const approvedResponse = await officerAFetch(`${API}/documents/${docA._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', remarks: 'Verified against source' })
    });
    assert.equal(approvedResponse.status, 200);
    assert.equal((await approvedResponse.json()).status, 'Verified');
    await expectStatus(adminFetch(`${API}/documents/${docB._id}/assignment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedOfficerId: officerB.user._id.toString() })
    }), 200, 'admin can assign a second document to another officer');
    await Document.updateOne({ _id: docB._id }, { $set: { status: 'Needs review' } });
    const rejectedResponse = await officerBFetch(`${API}/documents/${docB._id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', remarks: 'Source scan needs correction' })
    });
    assert.equal(rejectedResponse.status, 200);
    assert.equal((await rejectedResponse.json()).status, 'Rejected');
    await expectStatus(officerAFetch(`${API}/documents/${docA._id}/assignment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignedOfficerId: officerB.user._id.toString() })
    }), 403, 'officers cannot assign documents');
    await expectStatus(officerAFetch(`${API}/users/${citizenB.user._id}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Admin' })
    }), 403, 'officers cannot assign admin privileges');
    console.log('PASS assigned officers can save/review; officers cannot assign or manage roles');

    const allDocuments = await (await adminFetch(`${API}/documents`)).json();
    assert.ok(allDocuments.some(document => document._id === docA._id));
    assert.ok(allDocuments.some(document => document._id === docB._id));
    const invalidRole = await adminFetch(`${API}/users/${citizenB.user._id}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'SuperAdmin' })
    });
    assert.equal(invalidRole.status, 400);
    const roleUpdate = await adminFetch(`${API}/users/${officerB.user._id}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Admin' })
    });
    assert.equal(roleUpdate.status, 200);
    assert.equal((await roleUpdate.json()).user.role, 'Admin');
    await expectStatus(adminFetch(`${API}/users/${admin.user._id}/role`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'Citizen' })
    }), 403, 'administrators cannot change their own role');
    console.log('PASS admins can manage users while invalid roles and self-role changes are rejected');

    const previousBootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;
    const previousBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    try {
      process.env.BOOTSTRAP_ADMIN_EMAIL = `bootstrap-${crypto.randomUUID()}@example.test`;
      process.env.BOOTSTRAP_ADMIN_PASSWORD = `Bootstrap-${crypto.randomBytes(16).toString('hex')}!`;
      const bootstrapAdmin = await ensureBootstrapAdmin();
      const sameBootstrapAdmin = await ensureBootstrapAdmin();
      assert.equal(bootstrapAdmin.role, 'Admin');
      assert.equal(sameBootstrapAdmin._id.toString(), bootstrapAdmin._id.toString(), 'bootstrap should be idempotent');
      identities.push({ user: bootstrapAdmin, cookie: '' });
      process.env.BOOTSTRAP_ADMIN_EMAIL = citizenB.user.email;
      await assert.rejects(ensureBootstrapAdmin(), /non-admin account/);
      console.log('PASS Admin bootstrap is idempotent and cannot elevate an existing Citizen');
    } finally {
      if (previousBootstrapEmail === undefined) delete process.env.BOOTSTRAP_ADMIN_EMAIL;
      else process.env.BOOTSTRAP_ADMIN_EMAIL = previousBootstrapEmail;
      if (previousBootstrapPassword === undefined) delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
      else process.env.BOOTSTRAP_ADMIN_PASSWORD = previousBootstrapPassword;
    }

    const auditResponse = await adminFetch(`${API}/audit`);
    assert.equal(auditResponse.status, 200);
    const events = await auditResponse.json();
    const actions = events.map(event => event.action);
    assert.ok(actions.includes('DOCUMENT_HASH_GENERATED'));
    assert.ok(actions.includes('DOCUMENT_ASSIGNMENT_CHANGED'));
    assert.ok(actions.includes('DOCUMENT_REVIEW_DRAFT_SAVED'));
    assert.ok(actions.includes('DOCUMENT_APPROVED'));
    assert.ok(actions.includes('DOCUMENT_REJECTED'));
    assert.ok(actions.includes('USER_ROLE_CHANGED'));
    assert.ok(actions.includes('DOCUMENT_ACCESS_DENIED'));
    assert.ok(actions.includes('USER_REGISTERED'));
    assert.ok(actions.includes('LOGIN_SUCCEEDED'));
    assert.ok(actions.includes('LOGIN_FAILED'));
    assert.ok(actions.includes('LOGOUT'));
    assert.ok(actions.includes('CSRF_REQUEST_BLOCKED'));
    console.log('PASS persistent audit history records upload, access denial, review, assignment, and role changes');

    const missingSearch = await adminFetch(`${API}/search?q=land`);
    assert.equal(missingSearch.status, 404, 'this checkout has no separate search endpoint');
    console.log('PASS no separate search route exists; document lists are scope-filtered server-side');
    console.log('RBAC integration checks passed.');
  } finally {
    if (documentIds.length) {
      const docs = await Document.find({ _id: { $in: documentIds } }).select('fileMetadata.storedFilename');
      await Document.deleteMany({ _id: { $in: documentIds } });
      for (const document of docs) {
        const file = path.resolve(uploadDir, path.basename(document.fileMetadata.storedFilename));
        if (file.startsWith(`${uploadDir}${path.sep}`)) await fs.promises.unlink(file).catch(() => {});
      }
    }
    await cleanupTestIdentities(identities);
    await mongoose.disconnect();
  }
}

run().catch(error => {
  console.error('RBAC tests failed:', error);
  process.exitCode = 1;
});
