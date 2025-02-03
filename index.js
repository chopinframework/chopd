#!/usr/bin/env node

process.on('warning', () => { /* suppress all warnings */ });

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const onFinished = require('on-finished');
const rawBody = require('raw-body');
const crypto = require('crypto');

// Check built-in fetch
if (typeof fetch !== 'function') {
  console.error('[ERROR] No built-in fetch found. Use Node 20+ or Node 18 w/ --experimental-fetch.');
  process.exit(1);
}

const [, , proxyPortArg, targetPortArg] = process.argv;
const PROXY_PORT = proxyPortArg ? parseInt(proxyPortArg, 10) : 4000;
const TARGET_PORT = targetPortArg ? parseInt(targetPortArg, 10) : 3000;

const app = express();

// dev-address -> x-address
app.use(cookieParser());
app.use((req, res, next) => {
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    req.headers['x-address'] = devAddress;
  }
  next();
});

// Data for concurrency & logs
const queueMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
let isProcessing = false;
const requestQueue = [];
const logs = []; // array of { requestId, request, response, contexts, ... }
function pushLog(entry) { logs.push(entry); }

const contextsMap = new Map(); // requestId -> array of strings

// /_chopin routes
const chopinRouter = express.Router();
chopinRouter.use(express.json());

// /_chopin/login?as=0x...
chopinRouter.get('/login', (req, res) => {
  let address = req.query.as;
  if (!address || !/^0x[0-9A-Fa-f]{40}$/.test(address)) {
    const randomHex = crypto.randomBytes(20).toString('hex');
    address = `0x${randomHex}`;
  }
  res.cookie('dev-address', address, { httpOnly: false, sameSite: 'strict' });
  res.json({ success: true, address });
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

// /_chopin/logs => shows all logs
chopinRouter.get('/logs', (req, res) => {
  res.json(logs);
});

app.use('/_chopin', chopinRouter);

/* ------------------------------------------------------------------
   Manual concurrency for queued methods
------------------------------------------------------------------ */
app.use((req, res, next) => {
  if (!queueMethods.includes(req.method.toUpperCase())) {
    return next();
  }
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase()==='websocket') {
    return next();
  }

  const task = () => handleQueuedRequest(req, res).catch((err) => {
    console.error('[QUEUED] Error:', err);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
    isProcessing = false;
    processNext();
  });

  if (!isProcessing) {
    isProcessing = true;
    task();
  } else {
    requestQueue.push(task);
  }
});

function processNext() {
  if (requestQueue.length>0) {
    const nextTask = requestQueue.shift();
    nextTask();
  } else {
    isProcessing = false;
  }
}

async function handleQueuedRequest(req, res) {
  // read entire request body
  const bodyBuf = await rawBody(req, { limit: '2mb' });
  const requestId = crypto.randomUUID();

  // We'll store partial logs in contexts array
  const contexts = [];
  contextsMap.set(requestId, contexts);

  const requestLog = {
    requestId,
    method: req.method,
    url: req.url,
    headers: { ...req.headers },
    body: bodyBuf.toString('utf8'),
    contexts, // <--- rename partialContexts -> contexts
    timestamp: new Date().toISOString(),
  };

  // build callback URL
  const host = req.headers.host || `localhost:${PROXY_PORT}`;
  const callbackUrl = `http://${host}/_chopin/report-context?requestId=${requestId}`;

  // remove hop-by-hop headers
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['host'];
  delete forwardHeaders['content-length'];
  delete forwardHeaders['transfer-encoding'];

  forwardHeaders['x-callback-url'] = callbackUrl;

  const targetUrl = `http://localhost:${TARGET_PORT}${req.url}`;
  let targetRes, targetBuf;

  try {
    targetRes = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyBuf,
    });
    targetBuf = Buffer.from(await targetRes.arrayBuffer());
  } catch (err) {
    requestLog.responseError = err.message;
    pushLog(requestLog);
    res.status(502).json({ error: 'Bad Gateway', details: err.message });
    processNext();
    return;
  }

  // store the response
  requestLog.response = {
    status: targetRes.status,
    statusText: targetRes.statusText,
    headers: Object.fromEntries(targetRes.headers.entries()),
    body: targetBuf.toString('utf8'),
  };
  pushLog(requestLog);

  // pass the response to client
  res.status(targetRes.status);
  for (const [k,v] of Object.entries(requestLog.response.headers)) {
    if(!['transfer-encoding','content-length','connection'].includes(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  }
  res.send(targetBuf);

  processNext();
}

/* ------------------------------------------------------------------
   For GET + WebSockets => pass-through proxy
------------------------------------------------------------------ */
app.use(
  '/',
  createProxyMiddleware({
    target: `http://localhost:${TARGET_PORT}`,
    changeOrigin: true,
    ws: true
  })
);

/* ------------------------------------------------------------------
   Fallback
------------------------------------------------------------------ */
app.use((req, res) => {
  console.log('[DEBUG] fallback route for', req.method, req.url);
  res.status(404).send('Not Found');
});

app.listen(PROXY_PORT, () => {
  console.log(`Proxy w/ manual queued methods on http://localhost:${PROXY_PORT} -> :${TARGET_PORT}`);
});