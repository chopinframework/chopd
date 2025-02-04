#!/usr/bin/env node

/**
 * test-runner.js
 * Spawns:
 *   1) test-server.js (port 3100)
 *   2) index.js (the proxy) on port 4000 -> 3100
 *
 * Tests:
 *   - GET /hello -> 200
 *   - GET /bogus-route -> 404
 *   - 2 concurrent POST /slow (concurrency enforced)
 *   - dev-address cookie -> x-address
 *   - multi-context test => partial contexts
 *   - verify request/response bodies are in logs
 */

const { spawn } = require('child_process');

async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  // extend to 5000ms so we don't abort too soon
  const id = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 1) Start test-server.js
console.log('[TEST-RUNNER] Starting test-server.js on port 3100...');
const serverProcess = spawn('node', ['test-server.js'], {
  stdio: 'inherit',
  env: { ...process.env, TEST_SERVER_PORT: '3100' },
});

// 2) Start proxy (index.js) on 4000->3100
console.log('[TEST-RUNNER] Starting proxy (index.js) on port 4000->3100...');
const proxyProcess = spawn('node', ['index.js', '4000', '3100'], {
  stdio: 'inherit',
});

(async function runTests() {
  console.log('[TEST-RUNNER] Wait 1s for processes to come up...');
  await delay(1000);

  let passCount = 0;
  let failCount = 0;
  let done = false;

  function finalize() {
    if (done) return;
    done = true;
    console.log(`[TEST-RUNNER] passCount=${passCount}, failCount=${failCount}`);
    setTimeout(() => {
      serverProcess.kill('SIGTERM');
      proxyProcess.kill('SIGTERM');
      process.exit(failCount > 0 ? 1 : 0);
    }, 500);
  }

  // fallback timer if something never closes
  setTimeout(() => {
    console.log('[TEST-RUNNER] Force exit timeout...');
    finalize();
  }, 10000);

  try {
    // 1) GET /hello
    try {
      const res = await safeFetch('http://localhost:4000/hello');
      if (res.ok) {
        const txt = await res.text();
        console.log('[TEST-RUNNER] GET /hello ->', res.status, txt);
        passCount++;
      } else {
        failCount++;
        console.log('[TEST-RUNNER] GET /hello FAIL status=', res.status);
      }
    } catch (err) {
      failCount++;
      console.log('[TEST-RUNNER] GET /hello ERROR/HANG:', err.message);
    }

    // 2) GET /bogus-route => 404
    try {
      const res = await safeFetch('http://localhost:4000/bogus-route');
      console.log('[TEST-RUNNER] GET /bogus-route ->', res.status);
      if (res.status===404) passCount++;
      else failCount++;
    } catch (err) {
      failCount++;
      console.log('[TEST-RUNNER] GET /bogus-route ERROR/HANG:', err.message);
    }

    // 3) concurrency test with 2 POST /slow
    console.log('[TEST-RUNNER] concurrency test: 2 POST /slow in parallel...');
    const postPromises = [1, 2].map(async i => {
      try {
        const r = await safeFetch('http://localhost:4000/slow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client: i }),
        });
        if (r.status===201) {
          const j = await r.json();
          console.log(`[TEST-RUNNER] POST /slow #${i} -> 201`, j);
          return true;
        } else {
          console.log(`[TEST-RUNNER] POST /slow #${i} -> FAIL status=`, r.status);
          return false;
        }
      } catch (err) {
        console.log(`[TEST-RUNNER] POST /slow #${i} -> ERROR/HANG`, err.message);
        return false;
      }
    });
    const results = await Promise.all(postPromises);
    results.forEach(ok => { ok ? passCount++ : failCount++; });

    // check concurrencyError
    try {
      const res = await safeFetch('http://localhost:3100/check-concurrency');
      if (res.ok) {
        const { concurrencyError } = await res.json();
        if (concurrencyError) {
          failCount++;
          console.log('[TEST-RUNNER] concurrencyError=TRUE -> queue not enforced!');
        } else {
          passCount++;
          console.log('[TEST-RUNNER] concurrencyError=FALSE -> queue enforced');
        }
      } else {
        failCount++;
        console.log('[TEST-RUNNER] GET /check-concurrency FAIL status=', res.status);
      }
    } catch (err) {
      failCount++;
      console.log('[TEST-RUNNER] GET /check-concurrency ERROR/HANG:', err.message);
    }

    // 4) dev-address test
    const FAKE_ADDRESS = '0x1111111111111111111111111111111111111111';
    try {
      console.log('[TEST-RUNNER] Setting dev-address=?', FAKE_ADDRESS);
      const loginRes = await safeFetch(`http://localhost:4000/_chopin/login?as=${FAKE_ADDRESS}`);
      if (!loginRes.ok) {
        failCount++;
        console.log('[TEST-RUNNER] /_chopin/login FAIL status=', loginRes.status);
      } else {
        passCount++;
      }
      const setCookie = loginRes.headers.get('set-cookie');
      console.log('[TEST-RUNNER] set-cookie=', setCookie);
      if (setCookie) {
        const echoRes = await safeFetch('http://localhost:4000/echo-headers', {
          headers: { Cookie: setCookie },
        });
        if (echoRes.ok) {
          const hdr = await echoRes.json();
          console.log('[TEST-RUNNER] GET /echo-headers ->', hdr);
          if (hdr['x-address']===FAKE_ADDRESS) {
            passCount++;
            console.log('[TEST-RUNNER] X-Address forwarding confirmed');
          } else {
            failCount++;
            console.log('[TEST-RUNNER] X-Address mismatch:', hdr['x-address']);
          }
        } else {
          failCount++;
          console.log('[TEST-RUNNER] GET /echo-headers FAIL status=', echoRes.status);
        }
      } else {
        failCount++;
        console.log('[TEST-RUNNER] No set-cookie from /_chopin/login');
      }
    } catch(err) {
      failCount++;
      console.log('[TEST-RUNNER] dev-address test => ERROR/HANG', err.message);
    }

    // 5) multi-context + request/response body logs
    console.log('[TEST-RUNNER] Multi-context test + checking logs for request/response bodies...');
    try {
      const bodyToSend = { test: 'multi-context' };
      const slowRes = await safeFetch('http://localhost:4000/slow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyToSend),
      });
      if (slowRes.status!==201) {
        failCount++;
        console.log('[TEST-RUNNER] single POST /slow => FAIL status=', slowRes.status);
      } else {
        passCount++;
        console.log('[TEST-RUNNER] single POST /slow => 201 done');

        // now check /_chopin/logs
        const logsRes = await safeFetch('http://localhost:4000/_chopin/logs');
        if (!logsRes.ok) {
          failCount++;
          console.log('[TEST-RUNNER] GET /_chopin/logs => FAIL status=', logsRes.status);
        } else {
          const logsJson = await logsRes.json();
          if (!Array.isArray(logsJson) || logsJson.length<1) {
            failCount++;
            console.log('[TEST-RUNNER] No logs returned?');
          } else {
            // last entry
            const lastEntry = logsJson[logsJson.length-1];
            console.log('[TEST-RUNNER] last log entry =>', lastEntry);

            // 5a) request body check
            const expectedReqBody = JSON.stringify(bodyToSend);
            if (lastEntry.body !== expectedReqBody) {
              failCount++;
              console.log('[TEST-RUNNER] request body mismatch. got:', lastEntry.body, ' expected:', expectedReqBody);
            } else {
              passCount++;
              console.log('[TEST-RUNNER] request body is correct in logs');
            }

            // 5b) partial contexts
            const ctx = lastEntry.contexts; // assumption: we store them as .contexts
            if (!Array.isArray(ctx)) {
              failCount++;
              console.log('[TEST-RUNNER] no contexts array in last log entry');
            } else {
              const expCtx = ['context #1','context #2','context #3'];
              if (ctx.length===3 && ctx[0]===expCtx[0] && ctx[1]===expCtx[1] && ctx[2]===expCtx[2]) {
                passCount++;
                console.log('[TEST-RUNNER] partial contexts confirmed in correct order');
              } else {
                failCount++;
                console.log('[TEST-RUNNER] partial contexts mismatch => got:', ctx);
              }
            }

            // 5c) response body check
            if (!lastEntry.response || typeof lastEntry.response.body!=='string') {
              failCount++;
              console.log('[TEST-RUNNER] no response body found in logs?');
            } else {
              const gotResp = lastEntry.response.body;
              const expResp = '{"message":"Slow endpoint done"}';
              if (gotResp===expResp) {
                passCount++;
                console.log('[TEST-RUNNER] response body is correct in logs');
              } else {
                failCount++;
                console.log('[TEST-RUNNER] response body mismatch. got:', gotResp, 'expected:', expResp);
              }
            }
          }
        }
      }
    } catch (err) {
      failCount++;
      console.log('[TEST-RUNNER] multi-context test => ERROR/HANG', err.message);
    }

  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] top-level error:', err.message);
  } finally {
    finalize();
  }
})();