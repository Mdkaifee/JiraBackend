// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const User = require('../models/User');
const Otp = require('../models/Otp');
const { sendOtpMail } = require('../mailer');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// ------------------ Helper: Generate 6 Digit OTP ------------------
function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function sendResponse(res, statusCode, message, extra = {}) {
  const success = statusCode >= 200 && statusCode < 400;
  return res.status(statusCode).json({ success, message, ...extra });
}

function handleRouteError(res, label, err) {
  console.error(`${label}:`, err);
  return sendResponse(res, 500, 'Something went wrong. Please try again.');
}

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and profile related endpoints
 */

// ======================== SIGNUP FLOW =============================

// 1) SEND OTP FOR SIGNUP
// 1) Send OTP for signup
/**
 * @swagger
 * /auth/signup/send-otp:
 *   post:
 *     summary: Send a one-time password to start signup
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     otp:
 *                       type: string
 *                       description: Returned for testing purposes
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/signup/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return sendResponse(res, 400, 'Email is required');

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Otp.deleteMany({ email, type: 'signup' });

    await Otp.create({
      email,
      otpHash,
      type: 'signup',
      expiresAt
    });

    await sendOtpMail(email, otp);

    return sendResponse(res, 200, 'OTP sent to email', {
      otp // <-- return OTP in response for testing
    });

  } catch (err) {
    return handleRouteError(res, 'Signup send-otp error', err);
  }
});


// 2) VERIFY OTP → CREATE USER → AUTO LOGIN
/**
 * @swagger
 * /auth/signup/verify:
 *   post:
 *     summary: Verify OTP and create/login the user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Signup completed
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid OTP/validation error
 *       500:
 *         description: Server error
 */
router.post('/signup/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp)
      return sendResponse(res, 400, 'email and otp are required');

    const otpDoc = await Otp.findOne({ email, type: 'signup' }).sort({ createdAt: -1 });

    if (!otpDoc)
      return sendResponse(res, 400, 'OTP not found or expired');

    if (otpDoc.expiresAt < new Date()) {
      await otpDoc.deleteOne();
      return sendResponse(res, 400, 'OTP expired');
    }

    const isOtpValid = await bcrypt.compare(otp, otpDoc.otpHash);
    if (!isOtpValid)
      return sendResponse(res, 400, 'Invalid OTP');

    // Check if user exists
    let user = await User.findOne({ email });

    // If not, create empty profile user
    if (!user) {
      user = await User.create({
        email,
        fullName: "",
        passwordHash: "",
        token: ""
      });
    }

    await Otp.deleteMany({ email, type: 'signup' });

    // Create JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '12h'
    });

    // SAVE TOKEN IN DB
    user.token = token;
    await user.save();

    return sendResponse(res, 200, 'Signup success', {
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName
      },
      token
    });

  } catch (err) {
    return handleRouteError(res, 'Signup verify error', err);
  }
});

// ======================== LOGIN FLOW ==============================

// 0) CHECK IF USER EXISTS BEFORE ASKING FOR PASSWORD
/**
 * @swagger
 * /auth/login/check-email:
 *   post:
 *     summary: Check whether an account exists for the provided email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: User exists
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     exists:
 *                       type: boolean
 *                       example: true
 *                     email:
 *                       type: string
 *                       format: email
 *                     hasPassword:
 *                       type: boolean
 *                     fullName:
 *                       type: string
 *       404:
 *         description: User not found
 *       400:
 *         description: Validation error
 */
router.post('/login/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return sendResponse(res, 400, 'Email is required');

    const user = await User.findOne({ email });
    if (!user)
      return sendResponse(res, 404, 'User not found', { exists: false });

    return sendResponse(res, 200, 'User found', {
      exists: true,
      email: user.email,
      hasPassword: Boolean(user.passwordHash),
      fullName: user.fullName
    });

  } catch (err) {
    return handleRouteError(res, 'Login check-user error', err);
  }
});

// 1) CHECK PASSWORD → SEND LOGIN OTP
// 1) Check email + password & send OTP
/**
 * @swagger
 * /auth/login/send-otp:
 *   post:
 *     summary: Validate password and send login OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     otp:
 *                       type: string
 *                       description: Returned for testing purposes
 *       400:
 *         description: Invalid credentials or validation error
 *       500:
 *         description: Server error
 */
router.post('/login/send-otp', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return sendResponse(res, 400, 'email and password are required');

    const user = await User.findOne({ email });
    if (!user)
      return sendResponse(res, 400, 'Invalid credentials');

    if (!user.passwordHash)
      return sendResponse(res, 400, 'Please complete profile first');

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid)
      return sendResponse(res, 400, 'Invalid credentials');

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await Otp.deleteMany({ email, type: 'login' });

    await Otp.create({
      email,
      otpHash,
      type: 'login',
      expiresAt
    });

    await sendOtpMail(email, otp);

    return sendResponse(res, 200, 'OTP sent to email', {
      otp // <-- return OTP for testing
    });

  } catch (err) {
    return handleRouteError(res, 'Login send-otp error', err);
  }
});

// 2) VERIFY LOGIN OTP → RETURN JWT
/**
 * @swagger
 * /auth/login/verify:
 *   post:
 *     summary: Verify login OTP and return JWT token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login success
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     token:
 *                       type: string
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid OTP or user not found
 *       500:
 *         description: Server error
 */
router.post('/login/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp)
      return sendResponse(res, 400, 'email and otp are required');

    const otpDoc = await Otp.findOne({ email, type: 'login' }).sort({ createdAt: -1 });
    if (!otpDoc)
      return sendResponse(res, 400, 'OTP not found or expired');

    if (otpDoc.expiresAt < new Date()) {
      await otpDoc.deleteOne();
      return sendResponse(res, 400, 'OTP expired');
    }

    const isOtpValid = await bcrypt.compare(otp, otpDoc.otpHash);
    if (!isOtpValid)
      return sendResponse(res, 400, 'Invalid OTP');

    const user = await User.findOne({ email });
    if (!user)
      return sendResponse(res, 400, 'User not found');

    await Otp.deleteMany({ email, type: 'login' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '12h'
    });

    // SAVE TOKEN IN DB
    user.token = token;
    await user.save();

    return sendResponse(res, 200, 'Login success', {
      token,
      user
    });

  } catch (err) {
    return handleRouteError(res, 'Login verify error', err);
  }
});

// =================== UPDATE PROFILE ===================
/**
 * @swagger
 * /auth/update-profile:
 *   put:
 *     summary: Update the authenticated user's profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - password
 *             properties:
 *               fullName:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.put('/update-profile', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const { fullName, password } = req.body;

    if (!fullName || !password)
      return res.status(400).json({ message: 'fullName and password required' });

    const passwordHash = await bcrypt.hash(password, 10);

    await User.findByIdAndUpdate(userId, {
      fullName,
      passwordHash
    });

    return res.json({ message: 'Profile updated successfully' });

  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ======================== LOGOUT ==========================
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout the authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BaseResponse'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;

    // Clear token in DB
    await User.findByIdAndUpdate(userId, { token: "" });

    return res.json({ message: "Logout successful" });

  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
