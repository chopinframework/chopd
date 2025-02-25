const jwt = require('jsonwebtoken');

/**
 * Middleware to handle authentication from cookies or JWT
 */
function authMiddleware(req, res, next) {
  // Cookie-based authentication
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    req.headers['x-address'] = devAddress;
  }

  // JWT-based authentication
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      // Verify unsigned token
      const decoded = jwt.verify(token, '', { algorithms: ['none'] });
      if (decoded.sub) {
        req.headers['x-address'] = decoded.sub;
      }
    } catch (err) {
      // Invalid token - just continue without setting x-address
      console.log('[JWT] Invalid token:', err.message);
    }
  }
  
  next();
}

module.exports = authMiddleware; 