#!/usr/bin/env node

const express = require('express');
const cookieParser = require('cookie-parser');
const { createProxyMiddleware } = require('http-proxy-middleware');
const onFinished = require('on-finished');
const rawBody = require('raw-body');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child-process-promise');
const Ajv = require('ajv');

// If Node 18, run with --experimental-fetch or use Node 20+
if (typeof fetch !== 'function') {
  console.error('[ERROR] Built-in fetch not found. Use Node 20 or Node 18 w/ --experimental-fetch');
  process.exit(1);
}

// Load and validate config
let config = null;
try {
  const configPath = path.join(process.cwd(), 'chopin.config.json');
  const schemaPath = path.join(__dirname, 'schema.json');
  
  if (fs.existsSync(configPath)) {
    // Load schema and config
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    // Validate against schema
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    const valid = validate(config);
    
    if (!valid) {
      console.error('Invalid chopin.config.json:');
      validate.errors.forEach(error => {
        console.error(`- ${error.instancePath} ${error.message}`);
      });
      process.exit(1);
    }
    
    console.log('Found valid chopin.config.json:', config);
  }
} catch (err) {
  console.error('Error reading/validating config:', err.message);
  process.exit(1);
}

const [, , proxyPortArg, targetPortArg] = process.argv;
const PROXY_PORT = proxyPortArg ? parseInt(proxyPortArg, 10) : (config?.proxyPort || 4000);
const TARGET_PORT = targetPortArg ? parseInt(targetPortArg, 10) : (config?.targetPort || 3000);

// Spawn the target process if config exists
let targetProcess = null;
if (config && config.command) {
  console.log(`Starting target process: ${config.command}`);
  const [cmd, ...args] = config.command.split(' ');
  targetProcess = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ...(config.env || {})
    }
  }).catch(err => {
    console.error('Failed to start target process:', err.message);
    process.exit(1);
  });
}

// Handle process cleanup
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (targetProcess) {
    console.log('Stopping target process...');
    targetProcess.childProcess.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  if (targetProcess) {
    console.log('Stopping target process...');
    targetProcess.childProcess.kill();
  }
  process.exit(0);
});

const app = express();

// dev-address => x-address
app.use(cookieParser());
app.use((req, res, next) => {
  const devAddress = req.cookies['dev-address'];
  if (devAddress) {
    req.headers['x-address'] = devAddress;
  }
  next();
});

/* ------------------------------------------------------------------
   Data structures
------------------------------------------------------------------ */
const queueMethods = ['POST','PUT','PATCH','DELETE'];
let isProcessing = false;
const requestQueue = [];
const logs = [];
const contextsMap = new Map();  // requestId -> string[]

// We define a helper for partial contexts. We'll read the raw body as the context string.
async function readRawString(req) {
  // read entire request body up to 1MB or so
  return (await rawBody(req, { limit: '1mb' })).toString('utf8');
}

/* ------------------------------------------------------------------
   /_chopin routes
------------------------------------------------------------------ */
const chopinRouter = express.Router();
chopinRouter.use(express.json()); // only used for some routes, not the context route

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
// We directly read the body as a raw string => partial context
chopinRouter.post('/report-context', async (req, res) => {
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
chopinRouter.get('/logs', (req, res) => {
  const merged = logs.map(e => {
    const copy = { ...e };
    const cArr = contextsMap.get(e.requestId);
    copy.contexts = cArr || [];
    return copy;
  });
  res.json(merged);
});

app.use('/_chopin', chopinRouter);

/* ------------------------------------------------------------------
   Manual concurrency for queued methods
------------------------------------------------------------------ */
app.use(async (req, res, next) => {
  if (!queueMethods.includes(req.method.toUpperCase())) {
    return next();
  }
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    return next();
  }

  const task = () => handleQueuedRequest(req, res).catch(err => {
    console.error('[QUEUED] error:', err);
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
    const fn = requestQueue.shift();
    fn();
  } else {
    isProcessing = false;
  }
}

async function handleQueuedRequest(req, res) {
  // read entire request body for the queued method
  const bodyBuf = await rawBody(req, { limit: '2mb' });
  const requestId = crypto.randomUUID();
  contextsMap.set(requestId, []); // store partial contexts in a separate array

  const logEntry = {
    requestId,
    method: req.method,
    url: req.url,
    headers: { ...req.headers },
    body: bodyBuf.toString('utf8'),
    timestamp: new Date().toISOString(),
  };

  // build x-callback-url
  const host = req.headers.host || `localhost:${PROXY_PORT}`;
  const callbackUrl = `http://${host}/_chopin/report-context?requestId=${requestId}`;

  // remove hop-by-hop from forward
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
      body: bodyBuf
    });
    targetBuf = Buffer.from(await targetRes.arrayBuffer());
  } catch (err) {
    logEntry.responseError = err.message;
    logs.push(logEntry);
    res.status(502).json({ error: 'Bad Gateway', details: err.message });
    processNext();
    return;
  }

  // store response
  logEntry.response = {
    status: targetRes.status,
    statusText: targetRes.statusText,
    headers: Object.fromEntries(targetRes.headers.entries()),
    body: targetBuf.toString('utf8'),
  };
  logs.push(logEntry);

  // pass the response to client
  res.status(targetRes.status);
  for (const [k,v] of Object.entries(logEntry.response.headers)) {
    if(!['transfer-encoding','content-length','connection'].includes(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  }
  res.send(targetBuf);

  processNext();
}

/* ------------------------------------------------------------------
   Pass-through proxy for GET + websockets
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
  console.log(`Proxy on http://localhost:${PROXY_PORT} -> :${TARGET_PORT}`);
});