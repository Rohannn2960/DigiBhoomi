const mongoose = require('mongoose');

const USER_ROLES = Object.freeze(['Citizen', 'Officer', 'Admin']);

const UserSchema = new mongoose.Schema({
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  role: { type: String, enum: USER_ROLES, default: 'Citizen', required: true, index: true },
  passwordSalt: { type: String, required: true, select: false },
  passwordHash: { type: String, required: true, select: false },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
module.exports.USER_ROLES = USER_ROLES;