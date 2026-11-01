const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const { authenticate, requireRole } = require('../middleware/auth');
const { recordAuditEvent } = require('../services/audit');
const { publicUser } = require('../services/auth');

const router = express.Router();
router.use(authenticate, requireRole('Admin'));

router.get('/', async (request, response, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    return response.json(users.map(publicUser));
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/role', async (request, response, next) => {
  const { id } = request.params;
  const { role } = request.body || {};
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return response.status(400).json({ error: 'Invalid user ID format.' });
  }
  if (!User.USER_ROLES.includes(role)) {
    return response.status(400).json({ error: 'Role must be Citizen, Officer, or Admin.' });
  }
  if (id === request.user._id.toString()) {
    return response.status(403).json({ error: 'You cannot change your own role.' });
  }

  try {
    const user = await User.findById(id);
    if (!user) return response.status(404).json({ error: 'User not found.' });
    const previousRole = user.role;
    user.role = role;
    await user.save();
    await recordAuditEvent({
      actorId: request.user._id,
      action: 'USER_ROLE_CHANGED',
      resourceType: 'USER',
      resourceId: user._id.toString(),
      outcome: 'SUCCESS',
      metadata: { previousRole, newRole: role }
    });
    return response.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;