#!/usr/bin/env node

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const onFinished = require('on-finished');

// Simple CLI argument parsing
const [, , proxyPortArg, targetPortArg] = process.argv;
const PROXY_PORT = proxyPortArg ? parseInt(proxyPortArg, 10) : 4000;
const TARGET_PORT = targetPortArg ? parseInt(targetPortArg, 10) : 3000;

const app = express();

// 1) Debug logging
app.use((req, res, next) => {
  console.log(`[DEBUG] Incoming request: ${req.method} ${req.url}`);
  next();
});

// 2) Cookie parser
app.use(cookieParser());

// 3) dev-address login route
app.get('/_chopin/login', (req, res) => {
  let address = req.query.as;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    // Generate a random 40-hex address, e.g. 0xabcdef...
    const randomHex = (Math.random().toString(16).slice(2).padEnd(40, '0')).slice(0, 40);
    address = `0x${randomHex}`;
  }
  // Set dev-address cookie
  res.cookie('dev-address', address, {
    httpOnly: false, // so JS can read it if needed
    sameSite: 'strict',
  });
  res.json({ success: true, devAddress: address });
});

// 4) dev-address -> X-Address rewriting
app.use((req, res, next) => {
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    // Insert X-Address so the proxy sees it
    // (We mutate req.headers so createProxyMiddleware will forward it)
    req.headers['x-address'] = devAddress;
  }
  next();
});

// In-memory logs (no body)
const logs = [];

// Queue state
let isProcessing = false;
const requestQueue = [];

/**
 * queueMiddleware:
 *  - Logs each request (method, url, headers, timestamp)
 *  - Queues POST, PUT, PATCH, DELETE
 *  - Skips queue for GET, HEAD, OPTIONS, etc.
 */
function queueMiddleware(req, res, next) {
  logs.push({
    method: req.method,
    url: req.url,
    headers: req.headers,
    timestamp: new Date().toISOString(),
  });

  const queueMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!queueMethods.includes(req.method.toUpperCase())) {
    return next();
  }

  const startProcessing = () => {
    next();

    onFinished(res, () => {
      isProcessing = false;
      processQueue();
    });
  };

  if (!isProcessing) {
    isProcessing = true;
    startProcessing();
  } else {
    requestQueue.push(startProcessing);
  }
}

function processQueue() {
  if (requestQueue.length > 0) {
    isProcessing = true;
    const nextReq = requestQueue.shift();
    nextReq();
  }
}

// Attach queue
app.use(queueMiddleware);

// The proxy
app.use(
  '/',
  createProxyMiddleware({
    target: `http://localhost:${TARGET_PORT}`,
    changeOrigin: true,
  })
);

// Optional logs route
app.get('/internal-logs', (req, res) => {
  res.json(logs);
});

// Fallback route
app.use((req, res) => {
  console.log(`[DEBUG] Fallback route: no match for ${req.method} ${req.url}`);
  res.status(404).send('Not Found');
});

// Start
app.listen(PROXY_PORT, () => {
  console.log(`Proxy (step2) listening on http://localhost:${PROXY_PORT} -> http://localhost:${TARGET_PORT}`);
});
