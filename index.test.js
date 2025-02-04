// test-runner.test.js
// Run via: npx jest test-runner.test.js
// or add "test": "jest" in package.json scripts if you prefer.
//
// This file uses the built-in fetch (Node 18+ with --experimental-fetch or Node 20+).
// No node-fetch used.
//
// We spawn test-server.js (on 3100) and index.js (on 4000->3100),
// then run concurrency, partial context, dev-address tests, etc.

const { spawn } = require('child_process');
const { setTimeout: delay } = require('timers/promises');

if (typeof fetch !== 'function') {
  console.error('[JEST] No built-in fetch found. Use Node 20+ or run Node 18 with --experimental-fetch.');
  process.exit(1);
}

async function safeFetch(url, opts = {}) {
  // 5s fallback
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...opts });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// We'll do a short retry approach for partial contexts
async function retryLogsCheck(checkFn, maxTries=5, intervalMs=300) {
  for (let i=0; i<maxTries; i++) {
    const result = await checkFn();
    if (result.ok) return result.data;
    await delay(intervalMs);
  }
  return null; // not found after retries
}

describe('E2E Tests', () => {
  let serverProcess;
  let proxyProcess;

  beforeAll(async () => {
    console.log('[JEST] Starting test-server.js on port 3100...');
    serverProcess = spawn('node', ['test-server.js'], {
      stdio: 'inherit',
      env: { ...process.env, TEST_SERVER_PORT:'3100' },
    });

    console.log('[JEST] Starting proxy (index.js) on port 4000->3100...');
    proxyProcess = spawn('node', ['index.js', '4000', '3100'], {
      stdio: 'inherit',
    });

    // wait 1s
    await delay(1000);
  }, 10000);

  afterAll(async () => {
    console.log('[JEST] Stopping processes...');
    if (serverProcess) serverProcess.kill('SIGTERM');
    if (proxyProcess) proxyProcess.kill('SIGTERM');
    // small delay
    await delay(500);
  }, 5000);

  test('GET /hello => 200', async () => {
    const res = await safeFetch('http://localhost:4000/hello');
    expect(res.status).toBe(200);
    const txt = await res.text();
    console.log('[JEST] GET /hello =>', txt);
  });

  test('GET /bogus-route => 404', async () => {
    const res = await safeFetch('http://localhost:4000/bogus-route');
    expect(res.status).toBe(404);
  });

  test('Concurrency test: 2 POST /slow => 201 each, concurrencyError=FALSE', async () => {
    const tasks = [1,2].map(async i => {
      const r = await safeFetch('http://localhost:4000/slow', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ client:i })
      });
      expect(r.status).toBe(201);
      const j = await r.json();
      console.log(`[JEST] POST /slow #${i} =>`, j);
    });
    await Promise.all(tasks);

    // check concurrency
    const cRes = await safeFetch('http://localhost:3100/check-concurrency');
    expect(cRes.ok).toBe(true);
    const { concurrencyError } = await cRes.json();
    expect(concurrencyError).toBe(false);
  });

  test('dev-address => x-address', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const loginRes = await safeFetch(`http://localhost:4000/_chopin/login?as=${address}`);
    expect(loginRes.ok).toBe(true);

    const cookie = loginRes.headers.get('set-cookie');
    console.log('[JEST] set-cookie =>', cookie);
    expect(cookie).toBeTruthy();

    const echoRes = await safeFetch('http://localhost:4000/echo-headers', {
      headers: { Cookie: cookie },
    });
    expect(echoRes.ok).toBe(true);
    const hdr = await echoRes.json();
    console.log('[JEST] GET /echo-headers =>', hdr);
    expect(hdr['x-address']).toBe(address);
  });

  test('multi-context => partial contexts: "context #1", "#2", "#3"', async () => {
    // do a single POST /slow with { test:'multi-context' }
    const bodyToSend = { test:'multi-context' };
    const r = await safeFetch('http://localhost:4000/slow', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(bodyToSend),
    });
    expect(r.status).toBe(201);
    console.log('[JEST] multi-context => got 201, will check logs for partial contexts...');
  
    // We'll do a short "retry" approach
    // searching for the correct log entry
    const foundLog = await retryLogsCheck(async () => {
      const logsRes = await safeFetch('http://localhost:4000/_chopin/logs');
      if(!logsRes.ok) return { ok:false };
      const logsJson = await logsRes.json();
  
      // find the log with matching body
      const mcLog = logsJson.find(e =>
        e.method==='POST' && e.url==='/slow' &&
        e.body===JSON.stringify(bodyToSend)
      );
      if (!mcLog) {
        console.log('[JEST] Not found /slow w/ body=multi-context among', logsJson.length,'logs');
        return { ok:false };
      }
  
      console.log('[JEST] multi-context => found log =>', mcLog.requestId, mcLog.contexts);
      if (!Array.isArray(mcLog.contexts)) return { ok:false };
      if (
        mcLog.contexts.length>=3 &&
        mcLog.contexts[0]==='context #1' &&
        mcLog.contexts[1]==='context #2' &&
        mcLog.contexts[2]==='context #3'
      ) {
        return { ok:true, data: mcLog };
      }
      return { ok:false };
    }, 5, 300);
  
    // final assertion
    expect(foundLog).not.toBeNull();
    console.log('[JEST] partial contexts =>', foundLog.contexts);
  }, 10000);

  test('forcibly post raw text => verifying logs', async () => {
    // 1) single queued request
    const r = await safeFetch('http://localhost:4000/slow', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ forcedContextTest:true }),
    });
    expect(r.status).toBe(201);

    // get last log => requestId
    await delay(100);
    let logsRes = await safeFetch('http://localhost:4000/_chopin/logs');
    expect(logsRes.ok).toBe(true);
    const logsJson = await logsRes.json();
    const lastEntry = logsJson[logsJson.length-1];
    console.log('[JEST] forcibly post raw => lastEntry =>', lastEntry.requestId);

    const forcedText = 'Hello from forced raw text context.';
    const cbUrl = `http://localhost:4000/_chopin/report-context?requestId=${lastEntry.requestId}`;
    console.log('[JEST] posting partial context =>', forcedText);

    const forcedCtx = await safeFetch(cbUrl, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain' },
      body: forcedText,
    });
    expect(forcedCtx.ok).toBe(true);

    // do a short retry for logs
    const forcedResult = await retryLogsCheck(async() => {
      const lr = await safeFetch('http://localhost:4000/_chopin/logs');
      if(!lr.ok) return { ok:false };
      const lj = await lr.json();
      const last2 = lj[lj.length-1];
      console.log('[JEST] forced text check => contexts=', last2.contexts);
      if (Array.isArray(last2.contexts) && last2.contexts.includes(forcedText)) {
        return { ok:true, data:last2 };
      }
      return { ok:false };
    }, 5, 300);

    expect(forcedResult).not.toBeNull();
    console.log('[JEST] forcibly posted context => success =>', forcedResult.contexts);
  }, 10000);
});