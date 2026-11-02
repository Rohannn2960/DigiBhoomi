const express = require('express');
const AuditEvent = require('../models/AuditEvent');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('Admin'));

router.get('/', async (request, response, next) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 100, 1), 500);
    const events = await AuditEvent.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .populate('actorId', 'displayName email role')
      .lean();
    return response.json(events);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;