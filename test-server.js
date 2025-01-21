#!/usr/bin/env node

/**
 * test-server.js
 * A server on port 3100 for automated proxy tests.
 * - GET /hello -> immediate 200
 * - POST /slow -> concurrency check + partial context callbacks
 * - GET /check-concurrency -> returns if concurrency overlap happened
 * - GET /echo-headers -> returns final request headers
 * - 404 fallback
 */

const express = require('express');
const app = express();
app.use(express.json());

// If on Node 18, might need: node --experimental-fetch test-server.js
// Node 20+ has fetch built in.
async function safeFetch(url, opts) {
  // We'll do a short timeout so partial contexts can't hang forever
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    console.log('[TEST-SERVER] partial context call error:', err.message);
    return null; // we'll just ignore errors
  }
}

// concurrency tracking
let concurrencyCounter = 0;
let concurrencyError = false;

// GET /hello -> 200
app.get('/hello', (req, res) => {
  console.log('[TEST-SERVER] GET /hello');
  res.send('Hello from test-server');
});

// POST /slow -> concurrency check + partial context calls (if x-callback-url)
app.post('/slow', async (req, res) => {
  console.log('[TEST-SERVER] POST /slow - body:', req.body);
  concurrencyCounter++;
  if (concurrencyCounter > 1) {
    concurrencyError = true;
  }

  const callbackUrl = req.headers['x-callback-url'];
  console.log('[TEST-SERVER] x-callback-url=', callbackUrl || '(none)');

  // If we have a callback URL, let's send 3 partial contexts in order
  if (callbackUrl) {
    // We'll do them ~100ms apart
    for (let i = 1; i <= 3; i++) {
      await new Promise(r => setTimeout(r, 100));
      const contextStr = `context #${i}`;
      console.log(`[TEST-SERVER] sending partial context: "${contextStr}"`);
      // We call POST callbackUrl with { context: ... }
      await safeFetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: contextStr }),
      });
    }
  }

  // After 500ms total "work," respond
  setTimeout(() => {
    concurrencyCounter--;
    res.status(201).json({ message: 'Slow endpoint done' });
  }, 500);
});

// GET /check-concurrency -> { concurrencyError }
app.get('/check-concurrency', (req, res) => {
  res.json({ concurrencyError });
});

// GET /echo-headers
app.get('/echo-headers', (req, res) => {
  console.log('[TEST-SERVER] GET /echo-headers');
  res.json(req.headers);
});

// 404 fallback
app.use((req, res) => {
  console.log('[TEST-SERVER] 404 for', req.method, req.url);
  res.status(404).send('Not found on test-server');
});

// Start on 3100 by default
const PORT = process.env.TEST_SERVER_PORT || 3100;
app.listen(PORT, () => {
  console.log(`[TEST-SERVER] running on http://localhost:${PORT}`);
});
