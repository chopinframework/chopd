#!/usr/bin/env node

/**
 * test-server.js
 * A simple server on port 3100 (by default) for automated proxy tests.
 * - GET /hello -> immediate 200
 * - POST /slow -> simulates concurrency
 * - GET /check-concurrency -> returns if concurrency overlap happened
 * - GET /echo-headers -> returns the final request headers in JSON
 * - 404 fallback for anything else
 */

const express = require('express');
const app = express();
app.use(express.json());

// Track concurrency on /slow
let concurrencyCounter = 0;
let concurrencyError = false;

// GET /hello -> quick 200
app.get('/hello', (req, res) => {
  console.log('[TEST-SERVER] GET /hello');
  res.send('Hello from test-server');
});

// POST /slow -> simulate 500ms "work"
app.post('/slow', (req, res) => {
  console.log('[TEST-SERVER] POST /slow - body:', req.body);
  concurrencyCounter++;
  if (concurrencyCounter > 1) {
    concurrencyError = true;
  }
  setTimeout(() => {
    concurrencyCounter--;
    res.status(201).json({ message: 'Slow endpoint done' });
  }, 500);
});

// GET /check-concurrency
app.get('/check-concurrency', (req, res) => {
  res.json({ concurrencyError });
});

// GET /echo-headers
app.get('/echo-headers', (req, res) => {
  console.log('[TEST-SERVER] GET /echo-headers');
  res.json(req.headers);
});

// Fallback 404
app.use((req, res) => {
  console.log('[TEST-SERVER] 404 for', req.method, req.url);
  res.status(404).send('Not found on test-server');
});

// Default port 3100 (override with TEST_SERVER_PORT=... if needed)
const PORT = process.env.TEST_SERVER_PORT || 3100;
app.listen(PORT, () => {
  console.log(`[TEST-SERVER] running on http://localhost:${PORT}`);
});
