const express = require('express');
const User = require('../models/User');
const { authenticate, readCookie } = require('../middleware/auth');
const { loginRateLimit, registrationRateLimit } = require('../middleware/rateLimit');
const { recordAuditEvent } = require('../services/audit');
const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  getSessionUser,
  hashPassword,
  publicUser,
  revokeSession,
  verifyPassword
} = require('../services/auth');

const router = express.Router();
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  path: '/api',
  maxAge: SESSION_TTL_MS
};

router.post('/register', registrationRateLimit, async (request, response, next) => {
  const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim() : '';
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;

  if (!displayName || displayName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: 'Enter a valid name and email address.' });
  }

  let user = null;
  let session = null;
  try {
    const credentials = await hashPassword(password);
    user = await User.create({
      displayName,
      email,
      role: 'Citizen',
      passwordSalt: credentials.salt,
      passwordHash: credentials.hash
    });
    session = await createSession(user._id);
    await recordAuditEvent({
      actorId: user._id,
      action: 'USER_REGISTERED',
      resourceType: 'USER',
      resourceId: user._id.toString(),
      outcome: 'SUCCESS'
    });
    response.cookie(SESSION_COOKIE, session.token, { ...cookieOptions, expires: session.expiresAt });
    return response.status(201).json({ user: publicUser(user) });
  } catch (error) {
    if (session) await revokeSession(session.token).catch(() => {});
    if (user) await User.deleteOne({ _id: user._id }).catch(() => {});
    if (error.code === 11000) return response.status(409).json({ error: 'An account with that email already exists.' });
    if (error.message.includes('Password must')) return response.status(400).json({ error: error.message });
    return next(error);
  }
});

router.post('/login', loginRateLimit, async (request, response, next) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;

  try {
    const user = await User.findOne({ email, isActive: true }).select('+passwordSalt +passwordHash');
    const passwordMatches = user && await verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!passwordMatches) {
      await recordAuditEvent({
        action: 'LOGIN_FAILED',
        resourceType: 'AUTHENTICATION',
        outcome: 'DENIED'
      });
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const session = await createSession(user._id);
    try {
      await recordAuditEvent({
        actorId: user._id,
        action: 'LOGIN_SUCCEEDED',
        resourceType: 'AUTHENTICATION',
        outcome: 'SUCCESS'
      });
    } catch (error) {
      await revokeSession(session.token).catch(() => {});
      throw error;
    }
    response.cookie(SESSION_COOKIE, session.token, { ...cookieOptions, expires: session.expiresAt });
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', authenticate, (request, response) => {
  response.json({ user: publicUser(request.user) });
});

router.post('/logout', async (request, response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    const session = await getSessionUser(token);
    await revokeSession(token);
    const { maxAge, ...clearOptions } = cookieOptions;
    response.clearCookie(SESSION_COOKIE, clearOptions);
    if (session) {
      await recordAuditEvent({
        actorId: session.user._id,
        action: 'LOGOUT',
        resourceType: 'AUTHENTICATION',
        outcome: 'SUCCESS'
      });
    }
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;