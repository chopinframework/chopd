#!/usr/bin/env node

/**
 * Final concurrency proxy with:
 *  - /_chopin/login sets a dev-address cookie
 *  - /_chopin/report-context?requestId=... appends partial context logs
 *  - /_chopin/logs shows only queued "write" requests + partial logs
 *  - Queues POST, PUT, PATCH, DELETE (single concurrency)
 *  - Sets X-Callback-Url for queued requests
 *  - If dev-address cookie is present, sets X-Address on *all* proxied requests
 *  - Skips logging GET or other non-queued methods
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const onFinished = require('on-finished');
const crypto = require('crypto');

// CLI arguments for optional ports
const [, , proxyPortArg, targetPortArg] = process.argv;
const PROXY_PORT = proxyPortArg ? parseInt(proxyPortArg, 10) : 4000;
const TARGET_PORT = targetPortArg ? parseInt(targetPortArg, 10) : 3000;

const app = express();

/* ------------------------------------------------------------------
   1) Cookie Parser and dev-address -> X-Address logic
      (This must come BEFORE the queue + proxy)
------------------------------------------------------------------ */
app.use(cookieParser());

// If dev-address cookie is set, add X-Address to the request
app.use((req, res, next) => {
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    req.headers['x-address'] = devAddress;
  }
  next();
});

/* ------------------------------------------------------------------
   2) In-memory structures for queued logs + context
------------------------------------------------------------------ */
// We only queue + log these methods
const queueMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Minimal log entries for queued requests
// e.g. { method, url, timestamp, requestId }
let queuedLogs = [];

// For partial context logs
// contextsMap.get(requestId) -> array of strings
const contextsMap = new Map();

// Single concurrency
let isProcessing = false;
const requestQueue = [];

/* ------------------------------------------------------------------
   3) Define /_chopin routes FIRST, so they are NOT proxied or queued
------------------------------------------------------------------ */

// We'll attach a sub-router for /_chopin
const chopinRouter = express.Router();
// For these routes, we can parse JSON
chopinRouter.use(express.json());

// /_chopin/login?as=0x<40-hex> sets dev-address cookie
chopinRouter.get('/login', (req, res) => {
  let address = req.query.as;
  if (!address || !/^0x[0-9A-Fa-f]{40}$/.test(address)) {
    // generate random 40-hex
    const randomHex = crypto.randomBytes(20).toString('hex');
    address = `0x${randomHex}`;
  }
  res.cookie('dev-address', address, {
    httpOnly: false,
    sameSite: 'strict',
  });
  res.json({ success: true, devAddress: address });
});

// /_chopin/report-context?requestId=... -> partial logs
chopinRouter.post('/report-context', (req, res) => {
  const { requestId } = req.query;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId in query' });
  }
  const arr = contextsMap.get(requestId);
  if (!arr) {
    // means we don't have that requestId
    return res.status(404).json({ error: 'No matching requestId' });
  }
  const { context } = req.body || {};
  if (typeof context !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing context string' });
  }
  arr.push(context);
  res.json({ success: true });
});

// /_chopin/logs -> show queued "write" requests + context messages
chopinRouter.get('/logs', (req, res) => {
  // combine queuedLogs with contextsMap
  const combined = queuedLogs.map((logEntry) => {
    const copy = { ...logEntry };
    const arr = contextsMap.get(copy.requestId);
    if (arr) {
      copy.contexts = arr;
    }
    return copy;
  });
  res.json(combined);
});

app.use('/_chopin', chopinRouter);

/* ------------------------------------------------------------------
   4) Queue Middleware (for POST/PUT/PATCH/DELETE)
------------------------------------------------------------------ */
function queueMiddleware(req, res, next) {
  // Skip if not a queued method
  if (!queueMethods.includes(req.method.toUpperCase())) {
    return next();
  }

  // Generate requestId
  const requestId = crypto.randomUUID();

  // Build callback URL
  const hostHeader = req.headers.host || `localhost:${PROXY_PORT}`;
  const callbackUrl = `http://${hostHeader}/_chopin/report-context?requestId=${requestId}`;
  // Insert X-Callback-Url
  req.headers['x-callback-url'] = callbackUrl;

  // Log it
  const logEntry = {
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString(),
    requestId,
  };
  queuedLogs.push(logEntry);

  // Initialize context array
  contextsMap.set(requestId, []);

  // concurrency logic
  const startProcessing = () => {
    next();
    onFinished(res, () => {
      isProcessing = false;
      processNextInQueue();
    });
  };

  if (!isProcessing) {
    isProcessing = true;
    startProcessing();
  } else {
    requestQueue.push(startProcessing);
  }
}

function processNextInQueue() {
  if (requestQueue.length > 0) {
    isProcessing = true;
    const nextFn = requestQueue.shift();
    nextFn();
  }
}

app.use(queueMiddleware);

/* ------------------------------------------------------------------
   5) The Proxy
------------------------------------------------------------------ */
app.use(
  '/',
  createProxyMiddleware({
    target: `http://localhost:${TARGET_PORT}`,
    changeOrigin: true,
  })
);

/* ------------------------------------------------------------------
   6) Fallback
------------------------------------------------------------------ */
app.use((req, res) => {
  console.log(`[DEBUG] Fallback route for ${req.method} ${req.url}`);
  res.status(404).send('Not Found');
});

/* ------------------------------------------------------------------
   7) Start
------------------------------------------------------------------ */
app.listen(PROXY_PORT, () => {
  console.log(
    `Proxy listening on http://localhost:${PROXY_PORT} -> :${TARGET_PORT}`
  );
});
