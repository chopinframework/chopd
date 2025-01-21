#!/usr/bin/env node

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const onFinished = require('on-finished');
const crypto = require('crypto');

// CLI args
const [, , proxyPortArg, targetPortArg] = process.argv;
const PROXY_PORT = proxyPortArg ? parseInt(proxyPortArg, 10) : 4000;
const TARGET_PORT = targetPortArg ? parseInt(targetPortArg, 10) : 3000;

const app = express();

// 1) Global cookie parse -> dev-address => X-Address
app.use(cookieParser());
app.use((req, res, next) => {
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    req.headers['x-address'] = devAddress;
  }
  next();
});

/* ------------------------------------------------------------------
   Data structures for queued logs + contexts
------------------------------------------------------------------ */
const queueMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
let queuedLogs = [];
const contextsMap = new Map();

// Single concurrency
let isProcessing = false;
const requestQueue = [];

/* ------------------------------------------------------------------
   /_chopin routes (defined first)
------------------------------------------------------------------ */
const chopinRouter = express.Router();
chopinRouter.use(express.json());

// /_chopin/login?as=0x<40-hex>
chopinRouter.get('/login', (req, res) => {
  let address = req.query.as;
  if (!address || !/^0x[0-9A-Fa-f]{40}$/.test(address)) {
    const randomHex = crypto.randomBytes(20).toString('hex');
    address = `0x${randomHex}`;
  }
  res.cookie('dev-address', address, {
    httpOnly: false,
    sameSite: 'strict',
  });
  res.json({ success: true, devAddress: address });
});

// /_chopin/report-context?requestId=...
chopinRouter.post('/report-context', (req, res) => {
  const { requestId } = req.query;
  if (!requestId) {
    return res.status(400).json({ error: 'Missing requestId' });
  }
  const arr = contextsMap.get(requestId);
  if (!arr) {
    return res.status(404).json({ error: 'No matching requestId' });
  }
  const { context } = req.body || {};
  if (typeof context !== 'string') {
    return res.status(400).json({ error: 'Invalid context' });
  }
  arr.push(context);
  res.json({ success: true });
});

// /_chopin/logs -> show queued logs + context
chopinRouter.get('/logs', (req, res) => {
  const combined = queuedLogs.map((entry) => {
    const copy = { ...entry };
    const arr = contextsMap.get(copy.requestId);
    if (arr) copy.contexts = arr;
    return copy;
  });
  res.json(combined);
});

app.use('/_chopin', chopinRouter);

/* ------------------------------------------------------------------
   Queue middleware
------------------------------------------------------------------ */
function queueMiddleware(req, res, next) {
  // If it's a WebSocket upgrade, skip queue
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    return next();
  }

  // If not in queueMethods, skip
  if (!queueMethods.includes(req.method.toUpperCase())) {
    return next();
  }

  // Generate requestId
  const requestId = crypto.randomUUID();
  // Build callback URL
  const hostHeader = req.headers.host || `localhost:${PROXY_PORT}`;
  const callbackUrl = `http://${hostHeader}/_chopin/report-context?requestId=${requestId}`;
  req.headers['x-callback-url'] = callbackUrl;

  const logEntry = {
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString(),
    requestId,
  };
  queuedLogs.push(logEntry);
  contextsMap.set(requestId, []);

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
   The proxy - with ws: true to forward websockets
------------------------------------------------------------------ */
app.use(
  '/',
  createProxyMiddleware({
    target: `http://localhost:${TARGET_PORT}`,
    changeOrigin: true,
    ws: true,  // <--- enable WebSocket pass-through
  })
);

/* ------------------------------------------------------------------
   Fallback
------------------------------------------------------------------ */
app.use((req, res) => {
  console.log(`[DEBUG] Fallback for ${req.method} ${req.url}`);
  res.status(404).send('Not Found');
});

app.listen(PROXY_PORT, () => {
  console.log(`Proxy with WS pass-through on http://localhost:${PROXY_PORT} -> :${TARGET_PORT}`);
});
