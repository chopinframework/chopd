#!/usr/bin/env node

/**
 * test-runner.js
 * Spawns:
 *   1) test-server.js (port 3100)
 *   2) index.js (proxy) on port 4000 -> 3100
 *
 * Tests concurrency, dev-address, partial context, etc.
 */

const { spawn } = require('child_process');

async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 2000);
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
  return new Promise(r => setTimeout(r, ms));
}

// 1) Start test-server
console.log('[TEST-RUNNER] Starting test-server.js on 3100...');
const serverProcess = spawn('node', ['test-server.js'], {
  stdio: 'inherit',
  env: { ...process.env, TEST_SERVER_PORT: '3100' },
});

// 2) Start proxy on 4000->3100
console.log('[TEST-RUNNER] Starting proxy (index.js) on 4000->3100...');
const proxyProcess = spawn('node', ['index.js', '4000', '3100'], {
  stdio: 'inherit',
});

async function runTests() {
  console.log('[TEST-RUNNER] Wait 1s for processes to come up...');
  await delay(1000);

  let passCount = 0;
  let failCount = 0;

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

  // 2) 404 test
  try {
    const res = await safeFetch('http://localhost:4000/bogus-route');
    console.log('[TEST-RUNNER] GET /bogus-route ->', res.status);
    if (res.status === 404) passCount++;
    else failCount++;
  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] GET /bogus-route ERROR/HANG:', err.message);
  }

  // 3) concurrency test with 2 concurrent POST /slow
  console.log('[TEST-RUNNER] concurrency test: 2 POST /slow in parallel...');
  const postPromises = [1, 2].map(async i => {
    try {
      const r = await safeFetch('http://localhost:4000/slow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: i }),
      });
      if (r.status === 201) {
        const j = await r.json();
        console.log(`[TEST-RUNNER] POST /slow #${i} -> 201`, j);
        return true;
      } else {
        console.log(`[TEST-RUNNER] POST /slow #${i} -> FAIL status=`, r.status);
        return false;
      }
    } catch (err) {
      console.log(`[TEST-RUNNER] POST /slow #${i} ERROR/HANG`, err.message);
      return false;
    }
  });
  const results = await Promise.all(postPromises);
  results.forEach(ok => { ok ? passCount++ : failCount++; });

  // 4) check-concurrency -> concurrencyError=FALSE
  try {
    const r = await safeFetch('http://localhost:3100/check-concurrency');
    if (!r.ok) {
      failCount++;
      console.log('[TEST-RUNNER] GET /check-concurrency FAIL status=', r.status);
    } else {
      const { concurrencyError } = await r.json();
      if (concurrencyError) {
        failCount++;
        console.log('[TEST-RUNNER] concurrencyError=TRUE -> queue not enforced!');
      } else {
        passCount++;
        console.log('[TEST-RUNNER] concurrencyError=FALSE -> queue enforced');
      }
    }
  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] GET /check-concurrency ERROR/HANG:', err.message);
  }

  // 5) dev-address test
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

    // check x-address by calling /echo-headers w/ that cookie
    if (setCookie) {
      const echoRes = await safeFetch('http://localhost:4000/echo-headers', {
        headers: { Cookie: setCookie },
      });
      if (echoRes.ok) {
        const headersJson = await echoRes.json();
        console.log('[TEST-RUNNER] GET /echo-headers ->', headersJson);
        if (headersJson['x-address'] === FAKE_ADDRESS) {
          passCount++;
          console.log('[TEST-RUNNER] X-Address forwarding confirmed');
        } else {
          failCount++;
          console.log('[TEST-RUNNER] X-Address mismatch:', headersJson['x-address']);
        }
      } else {
        failCount++;
        console.log('[TEST-RUNNER] GET /echo-headers FAIL status=', echoRes.status);
      }
    } else {
      failCount++;
      console.log('[TEST-RUNNER] no Set-Cookie from /_chopin/login');
    }
  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] dev-address test ERROR/HANG:', err.message);
  }

  // 6) Now the partial context test: multiple contexts from the test server
  //    We'll do a single POST /slow, which triggers 3 partial logs from the server
  //    Then we confirm in /_chopin/logs that we have the correct order
  console.log('[TEST-RUNNER] Multi-context test: POST /slow => context #1,#2,#3...');
  try {
    // Do one POST /slow
    const res = await safeFetch('http://localhost:4000/slow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'multi-context' }),
    });
    if (res.status !== 201) {
      failCount++;
      console.log('[TEST-RUNNER] single POST /slow => FAIL status=', res.status);
    } else {
      passCount++;
      console.log('[TEST-RUNNER] single POST /slow => 201 done');

      // Now let's check /_chopin/logs
      const logsRes = await safeFetch('http://localhost:4000/_chopin/logs');
      if (!logsRes.ok) {
        failCount++;
        console.log('[TEST-RUNNER] GET /_chopin/logs => FAIL status=', logsRes.status);
      } else {
        const logsJson = await logsRes.json();
        if (!Array.isArray(logsJson) || logsJson.length < 1) {
          failCount++;
          console.log('[TEST-RUNNER] No queued logs at all?');
        } else {
          // The last queued request should be our single POST /slow
          const last = logsJson[logsJson.length - 1];
          console.log('[TEST-RUNNER] last log entry =>', last);
          const { contexts } = last;
          if (!contexts) {
            failCount++;
            console.log('[TEST-RUNNER] no contexts array in last log entry');
          } else {
            // Expect ["context #1","context #2","context #3"] in this order
            const expected = ['context #1', 'context #2', 'context #3'];
            if (contexts.length === 3 &&
              contexts[0] === 'context #1' &&
              contexts[1] === 'context #2' &&
              contexts[2] === 'context #3') {
              passCount++;
              console.log('[TEST-RUNNER] partial contexts confirmed in correct order');
            } else {
              failCount++;
              console.log('[TEST-RUNNER] partial contexts mismatch -> got:', contexts);
            }
          }
        }
      }
    }
  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] multi-context test => ERROR/HANG', err.message);
  }

  // Final results
  console.log(`[TEST-RUNNER] passCount=${passCount}, failCount=${failCount}`);
  await delay(500);
  console.log('[TEST-RUNNER] stopping processes...');
  serverProcess.kill('SIGTERM');
  proxyProcess.kill('SIGTERM');
  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('[TEST-RUNNER] Fatal error:', err);
  serverProcess.kill('SIGTERM');
  proxyProcess.kill('SIGTERM');
  process.exit(1);
});
