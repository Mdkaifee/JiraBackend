const express = require('express');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

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
 *   name: Users
 *   description: User directory helpers
 */

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List users for assignment dropdowns
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Users fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/BaseResponse'
 *                 - type: object
 *                   properties:
 *                     users:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, { email: 1, fullName: 1 }).sort({ createdAt: -1 });
    return sendResponse(res, 200, 'Users fetched', { users });
  } catch (err) {
    return handleRouteError(res, 'List users error', err);
  }
});

module.exports = router;
