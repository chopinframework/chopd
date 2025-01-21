#!/usr/bin/env node

/**
 * test-runner.js
 * Spawns:
 *   1) test-server.js (port 3100)
 *   2) index.js (your main proxy) on port 4000 -> 3100
 *
 * Then it runs:
 *   - GET /hello -> 200
 *   - GET /bogus-route -> 404
 *   - Two concurrent POST /slow -> ensures queue is enforced (no concurrency)
 *   - GET /check-concurrency -> verifies concurrencyError=FALSE
 *   - GET /_chopin/login?as=<valid 40-hex> -> sets dev-address cookie
 *   - GET /echo-headers with that cookie -> should see X-Address = same 40-hex
 *
 * If anything fails or times out, we increment failCount and exit(1).
 * Otherwise passCount increments and we exit(0).
 */

const { spawn } = require('child_process');

// If Node 20+, fetch is built in. If Node 18, might need `node --experimental-fetch`.
async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 2000); // 2s timeout
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

// 1) Start the test server on 3100
console.log('[TEST-RUNNER] Starting test-server.js on port 3100...');
const serverProcess = spawn('node', ['test-server.js'], {
  stdio: 'inherit', // pass logs
  env: { ...process.env, TEST_SERVER_PORT: '3100' },
});

// 2) Start your proxy script (index.js) on 4000 -> 3100
console.log('[TEST-RUNNER] Starting proxy (index.js) on port 4000 -> 3100...');
const proxyProcess = spawn('node', ['index.js', '4000', '3100'], {
  stdio: 'inherit',
});

async function runTests() {
  console.log('[TEST-RUNNER] Waiting 1s for servers to start up...');
  await delay(1000);

  let passCount = 0;
  let failCount = 0;

  // 1) GET /hello
  try {
    const res = await safeFetch('http://localhost:4000/hello');
    if (res.ok) {
      const text = await res.text();
      console.log('[TEST-RUNNER] GET /hello ->', res.status, text);
      passCount++;
    } else {
      console.log('[TEST-RUNNER] GET /hello -> FAIL:', res.status);
      failCount++;
    }
  } catch (err) {
    console.log('[TEST-RUNNER] GET /hello -> ERROR/HANG:', err.message);
    failCount++;
  }

  // 2) 404 test
  try {
    const res = await safeFetch('http://localhost:4000/bogus-route');
    console.log('[TEST-RUNNER] GET /bogus-route ->', res.status);
    if (res.status === 404) passCount++;
    else failCount++;
  } catch (err) {
    console.log('[TEST-RUNNER] GET /bogus-route -> ERROR/HANG:', err.message);
    failCount++;
  }

  // 3) Two concurrent POST /slow
  console.log('[TEST-RUNNER] Sending 2 concurrent POST /slow...');
  const postPromises = [1, 2].map(async i => {
    try {
      const res = await safeFetch('http://localhost:4000/slow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: i }),
      });
      if (res.status === 201) {
        const json = await res.json();
        console.log(`[TEST-RUNNER] POST /slow #${i} -> 201`, json);
        return true;
      } else {
        console.log(`[TEST-RUNNER] POST /slow #${i} -> FAIL status=`, res.status);
        return false;
      }
    } catch (err) {
      console.log(`[TEST-RUNNER] POST /slow #${i} -> ERROR/HANG`, err.message);
      return false;
    }
  });
  const results = await Promise.all(postPromises);
  results.forEach(ok => { ok ? passCount++ : failCount++; });

  // 4) GET /check-concurrency
  try {
    const res = await safeFetch('http://localhost:3100/check-concurrency');
    if (!res.ok) {
      console.log('[TEST-RUNNER] GET /check-concurrency -> FAIL status=', res.status);
      failCount++;
    } else {
      const { concurrencyError } = await res.json();
      if (concurrencyError) {
        console.log('[TEST-RUNNER] concurrencyError=TRUE -> queue not enforced!');
        failCount++;
      } else {
        console.log('[TEST-RUNNER] concurrencyError=FALSE -> queue is enforced');
        passCount++;
      }
    }
  } catch (err) {
    console.log('[TEST-RUNNER] GET /check-concurrency -> ERROR/HANG:', err.message);
    failCount++;
  }

  // 5) Test dev-address cookie -> X-Address
  const FAKE_ADDRESS = '0x1111111111111111111111111111111111111111'; // valid 40-hex
  try {
    console.log('[TEST-RUNNER] Setting dev-address cookie with as=', FAKE_ADDRESS);
    // 5a) /_chopin/login
    const loginRes = await safeFetch(`http://localhost:4000/_chopin/login?as=${FAKE_ADDRESS}`);
    if (!loginRes.ok) {
      console.log('[TEST-RUNNER] /_chopin/login -> FAIL status=', loginRes.status);
      failCount++;
    } else {
      passCount++;
    }
    const setCookie = loginRes.headers.get('set-cookie');
    console.log('[TEST-RUNNER] /_chopin/login set-cookie=', setCookie);

    // 5b) GET /echo-headers with that cookie -> see if x-address = FAKE_ADDRESS
    if (setCookie) {
      const echoRes = await safeFetch('http://localhost:4000/echo-headers', {
        headers: {
          Cookie: setCookie,
        },
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
        console.log('[TEST-RUNNER] GET /echo-headers -> FAIL status=', echoRes.status);
      }
    } else {
      failCount++;
      console.log('[TEST-RUNNER] No Set-Cookie from /_chopin/login');
    }
  } catch (err) {
    failCount++;
    console.log('[TEST-RUNNER] dev-address test -> ERROR/HANG:', err.message);
  }

  console.log(`[TEST-RUNNER] passCount=${passCount}, failCount=${failCount}`);

  // stop processes
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
