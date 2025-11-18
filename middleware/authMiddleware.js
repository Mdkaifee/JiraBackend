// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader)
    return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // confirm token matches DB
    const user = await User.findById(decoded.userId);
    if (!user || user.token !== token) {
      return res.status(401).json({ message: 'Session expired, please login again' });
    }

    req.user = decoded; // gives req.user.userId
    next();

  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
