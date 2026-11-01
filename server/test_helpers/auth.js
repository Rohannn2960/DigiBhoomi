const { TEST_API_BASE_URL, TEST_API_ORIGIN, TEST_MONGODB_URI } = require('./config');
const mongoose = require('mongoose');
const User = require('../models/User');
const Session = require('../models/Session');
const AuditEvent = require('../models/AuditEvent');
const { hashPassword } = require('../services/auth');

let ownsConnection = false;

async function ensureDatabaseConnection() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(TEST_MONGODB_URI);
  ownsConnection = true;
}

async function createTestIdentity(role = 'Admin') {
  await ensureDatabaseConnection();
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = `Test-only-${suffix}-Password!`;
  const credentials = await hashPassword(password);
  const user = await User.create({
    displayName: `Test ${role}`,
    email: `digibhoomi-${suffix}@example.test`,
    role,
    passwordSalt: credentials.salt,
    passwordHash: credentials.hash
  });

  const response = await fetch(`${TEST_API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password })
  });
  if (!response.ok) {
    await User.deleteOne({ _id: user._id });
    throw new Error(`Test identity login failed with HTTP ${response.status}.`);
  }
  const cookieHeader = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (!cookieHeader) throw new Error('Authentication response did not set a session cookie.');
  return { user, cookie: cookieHeader.split(';')[0] };
}

function makeAuthenticatedFetch(cookie, baseFetch = global.fetch) {
  return (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, TEST_API_ORIGIN);
    if (url.origin !== TEST_API_ORIGIN) return baseFetch(input, options);
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('Cookie', cookie);
    return baseFetch(input, { ...options, headers });
  };
}

async function installTestIdentity(role = 'Admin') {
  const identity = await createTestIdentity(role);
  const originalFetch = global.fetch;
  global.fetch = makeAuthenticatedFetch(identity.cookie, originalFetch);
  return async () => {
    global.fetch = originalFetch;
    await cleanupTestIdentities([identity]);
  };
}

async function cleanupTestIdentities(identities) {
  for (const { user } of identities) {
    await Session.deleteMany({ userId: user._id });
    await AuditEvent.deleteMany({ actorId: user._id });
    await User.deleteOne({ _id: user._id });
  }
  if (ownsConnection) {
    ownsConnection = false;
    await mongoose.disconnect();
  }
}

module.exports = { cleanupTestIdentities, createTestIdentity, installTestIdentity, makeAuthenticatedFetch };