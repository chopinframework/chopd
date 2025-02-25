const crypto = require('crypto');
const rawBody = require('raw-body');

// Import logs and contextsMap from chopin routes
const { logs, contextsMap } = require('../routes/chopin');

// Constants and state
const queueMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
let isProcessing = false;
const requestQueue = [];

/**
 * Process the next request in the queue
 */
function processNext() {
  if (requestQueue.length > 0) {
    const fn = requestQueue.shift();
    fn();
  } else {
    isProcessing = false;
  }
}

/**
 * Handle a queued request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
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
  const host = req.headers.host || `localhost:${req.app.get('proxyPort')}`;
  const callbackUrl = `http://${host}/_chopin/report-context?requestId=${requestId}`;

  // remove hop-by-hop from forward
  const forwardHeaders = { ...req.headers };
  delete forwardHeaders['host'];
  delete forwardHeaders['content-length'];
  delete forwardHeaders['transfer-encoding'];
  forwardHeaders['x-callback-url'] = callbackUrl;

  const targetUrl = `http://localhost:${req.app.get('targetPort')}${req.url}`;

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
  for (const [k, v] of Object.entries(logEntry.response.headers)) {
    if(!['transfer-encoding', 'content-length', 'connection'].includes(k.toLowerCase())) {
      res.setHeader(k, v);
    }
  }
  res.send(targetBuf);

  processNext();
}

/**
 * Middleware to handle request queuing
 */
function requestQueueMiddleware(req, res, next) {
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
}

module.exports = requestQueueMiddleware; 