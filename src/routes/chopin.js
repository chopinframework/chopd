const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rawBody = require('raw-body');

const router = express.Router();

// Data structures for logs and contexts
const logs = [];
const contextsMap = new Map(); // requestId -> string[]

/**
 * Helper to read raw body as string
 * @param {Object} req - Express request
 * @returns {Promise<string>} Raw body as string
 */
async function readRawString(req) {
  return (await rawBody(req, { limit: '1mb' })).toString('utf8');
}

// /_chopin/login?as=0x...
router.get('/login', (req, res) => {
  let address = req.query.as;
  if (!address || !/^0x[0-9A-Fa-f]{40}$/.test(address)) {
    const randomHex = crypto.randomBytes(20).toString('hex');
    address = `0x${randomHex}`;
  }
  
  // Generate an unsigned JWT with the address as the subject
  const token = jwt.sign({ sub: address }, '', { algorithm: 'none' });
  
  // Set both cookie and return JWT
  res.cookie('dev-address', address, { httpOnly: false, sameSite: 'strict' });
  res.json({ success: true, address, token });
});

// /_chopin/logout - clears the dev-address cookie
router.get('/logout', (req, res) => {
  // Clear the dev-address cookie
  res.clearCookie('dev-address');
  // Redirect to the root route instead of returning JSON
  res.redirect('/');
});

// /_chopin/report-context?requestId=...
router.post('/report-context', async (req, res) => {
  const { requestId } = req.query;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId' });
  }
  const arr = contextsMap.get(requestId);
  if (!arr) {
    return res.status(404).json({ error: 'No matching requestId' });
  }
  // read raw text body
  let contextString;
  try {
    contextString = await readRawString(req);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid raw body' });
  }
  arr.push(contextString);
  res.json({ success: true });
});

// /_chopin/logs => merges logs + contexts
router.get('/logs', (req, res) => {
  const merged = logs.map(e => {
    const copy = { ...e };
    const cArr = contextsMap.get(e.requestId);
    copy.contexts = cArr || [];
    return copy;
  });
  res.json(merged);
});

// /_chopin/status => always returns "ok"
router.get('/status', (req, res) => {
  res.json({ status: "ok" });
});

// /_chopin/me => returns current address from cookie or JWT
router.get('/me', (req, res) => {
  // Check cookie first
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    return res.json({ address: devAddress });
  }
  
  // Then check JWT
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, '', { algorithms: ['none'] });
      if (decoded.sub) {
        return res.json({ address: decoded.sub });
      }
    } catch (err) {
      // Invalid token - just continue
    }
  }
  
  // No address found
  res.json({ address: null });
});

module.exports = {
  router,
  logs,
  contextsMap
}; 