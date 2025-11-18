// models/Otp.js
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true },
    otpHash: { type: String, required: true },
    type: { type: String, enum: ['signup', 'login'], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Optional: index for automatic cleanup
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
