// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    fullName: { type: String, default: "" },
    passwordHash: { type: String, default: "" },
    token: { type: String, default: "" }     // <-- store token here
  },
  { timestamps: true }
);


module.exports = mongoose.model('User', userSchema);
