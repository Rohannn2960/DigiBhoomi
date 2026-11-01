const crypto = require('crypto');
const { promisify } = require('util');
const User = require('../models/User');
const Session = require('../models/Session');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = 'digibhoomi_session';

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Password must be between 12 and 256 characters.');
  }
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString('hex') };
}

async function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== 'string' || !salt || !expectedHash) return false;
  const actualHash = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actualHash.length === expected.length && crypto.timingSafeEqual(actualHash, expected);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await Session.create({ userId, tokenHash: hashSessionToken(token), expiresAt });
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token || token.length > 128) return null;
  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() }
  });
  if (!session) return null;
  const user = await User.findOne({ _id: session.userId, isActive: true });
  return user ? { user, session } : null;
}

async function revokeSession(token) {
  if (token) await Session.deleteOne({ tokenHash: hashSessionToken(token) });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    displayName: user.displayName,
    email: user.email,
    role: user.role
  };
}

async function ensureBootstrapAdmin() {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email && !password) return null;
  if (!email || !password) throw new Error('Set both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.');

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role !== 'Admin') {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL belongs to a non-admin account. Configure a new admin email.');
    }
    return existing;
  }

  const credentials = await hashPassword(password);
  return User.create({
    displayName: 'System Administrator',
    email,
    role: 'Admin',
    passwordSalt: credentials.salt,
    passwordHash: credentials.hash
  });
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  ensureBootstrapAdmin,
  getSessionUser,
  hashPassword,
  hashSessionToken,
  publicUser,
  revokeSession,
  verifyPassword
};