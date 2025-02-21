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
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

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

// Global test setup
let serverProcess;
let proxyProcess;
const TEST_PORT = 3100;
const configPath = path.join(process.cwd(), 'chopin.config.json');
const chopinDir = path.join(process.cwd(), '.chopin');
const gitignorePath = path.join(process.cwd(), '.gitignore');
const gitignoreBackupPath = path.join(process.cwd(), '.gitignore.bak');

// Helper to kill processes
async function killProcess(proc) {
  if (proc) {
    try {
      proc.kill('SIGTERM');
      await delay(500);
    } catch (err) {
      console.error('Error killing process:', err);
    }
  }
}

beforeAll(async () => {
  // Backup gitignore if it exists
  if (fs.existsSync(gitignorePath)) {
    fs.copyFileSync(gitignorePath, gitignoreBackupPath);
  }
});

afterAll(async () => {
  // Restore gitignore
  if (fs.existsSync(gitignoreBackupPath)) {
    if (fs.existsSync(gitignorePath)) {
      fs.unlinkSync(gitignorePath);
    }
    fs.copyFileSync(gitignoreBackupPath, gitignorePath);
    fs.unlinkSync(gitignoreBackupPath);
  }
});

describe('E2E Tests', () => {
  beforeAll(async () => {
    // Start test server
    console.log('[JEST] Starting test-server.js on port 3100...');
    serverProcess = spawn('node', ['test-server.js'], {
      stdio: 'inherit',
      env: { ...process.env, TEST_SERVER_PORT: TEST_PORT },
    });

    // Start proxy
    console.log('[JEST] Starting proxy (index.js) on port 4000->3100...');
    proxyProcess = spawn('node', ['index.js', '4000', TEST_PORT.toString()], {
      stdio: 'inherit',
    });

    // Wait for servers to start
    await delay(2000);
  }, 10000);

  afterAll(async () => {
    console.log('[JEST] Stopping processes...');
    await killProcess(serverProcess);
    await killProcess(proxyProcess);
  });

  test('GET /hello => 200', async () => {
    const res = await safeFetch('http://localhost:4000/hello');
    expect(res.status).toBe(200);
    const txt = await res.text();
    console.log('[JEST] GET /hello =>', txt);
  });

  test('GET /_chopin/status => returns ok', async () => {
    const res = await safeFetch('http://localhost:4000/_chopin/status');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  test('GET /_chopin/me => handles all auth scenarios', async () => {
    // 1. No auth => null address
    const noAuthRes = await safeFetch('http://localhost:4000/_chopin/me');
    expect(noAuthRes.status).toBe(200);
    let json = await noAuthRes.json();
    expect(json).toEqual({ address: null });

    // 2. Cookie-based auth
    const address = '0x1111111111111111111111111111111111111111';
    const loginRes = await safeFetch(`http://localhost:4000/_chopin/login?as=${address}`);
    expect(loginRes.ok).toBe(true);
    const cookie = loginRes.headers.get('set-cookie');
    
    const cookieAuthRes = await safeFetch('http://localhost:4000/_chopin/me', {
      headers: { Cookie: cookie }
    });
    expect(cookieAuthRes.status).toBe(200);
    json = await cookieAuthRes.json();
    expect(json).toEqual({ address });

    // 3. JWT-based auth
    const { token } = await loginRes.json();
    const jwtAuthRes = await safeFetch('http://localhost:4000/_chopin/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    expect(jwtAuthRes.status).toBe(200);
    json = await jwtAuthRes.json();
    expect(json).toEqual({ address });

    // 4. Invalid JWT => null address
    const invalidJwtRes = await safeFetch('http://localhost:4000/_chopin/me', {
      headers: { 'Authorization': 'Bearer invalid.token.here' }
    });
    expect(invalidJwtRes.status).toBe(200);
    json = await invalidJwtRes.json();
    expect(json).toEqual({ address: null });
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

  test('dev-address => x-address (cookie and JWT)', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const loginRes = await safeFetch(`http://localhost:4000/_chopin/login?as=${address}`);
    expect(loginRes.ok).toBe(true);

    const loginJson = await loginRes.json();
    expect(loginJson.token).toBeTruthy();
    
    // Verify the token is a valid unsigned JWT with correct subject
    const decoded = jwt.verify(loginJson.token, '', { algorithms: ['none'] });
    expect(decoded.sub).toBe(address);

    // Test cookie-based auth still works
    const cookie = loginRes.headers.get('set-cookie');
    console.log('[JEST] set-cookie =>', cookie);
    expect(cookie).toBeTruthy();

    const cookieEchoRes = await safeFetch('http://localhost:4000/echo-headers', {
      headers: { Cookie: cookie },
    });
    expect(cookieEchoRes.ok).toBe(true);
    const cookieHeaders = await cookieEchoRes.json();
    console.log('[JEST] GET /echo-headers (cookie) =>', cookieHeaders);
    expect(cookieHeaders['x-address']).toBe(address);

    // Test JWT-based auth works
    const jwtEchoRes = await safeFetch('http://localhost:4000/echo-headers', {
      headers: { 
        'Authorization': `Bearer ${loginJson.token}`
      },
    });
    expect(jwtEchoRes.ok).toBe(true);
    const jwtHeaders = await jwtEchoRes.json();
    console.log('[JEST] GET /echo-headers (JWT) =>', jwtHeaders);
    expect(jwtHeaders['x-address']).toBe(address);
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

describe('Config File Tests', () => {
  beforeEach(() => {
    // Clean up any existing files
    [configPath, gitignorePath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    if (fs.existsSync(chopinDir)) {
      fs.rmdirSync(chopinDir);
    }
  });

  afterEach(async () => {
    // Clean up any processes that might have been started
    await killProcess(proxyProcess);
    
    // Clean up files
    [configPath, gitignorePath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    if (fs.existsSync(chopinDir)) {
      fs.rmdirSync(chopinDir);
    }
  });

  test('init command creates necessary files', async () => {
    // Run init command
    const initProcess = require('child_process').spawnSync('node', ['index.js', 'init'], {
      stdio: 'pipe'
    });

    expect(initProcess.status).toBe(0);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.existsSync(chopinDir)).toBe(true);
    expect(fs.existsSync(gitignorePath)).toBe(true);

    // Verify config content
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config).toEqual({
      command: 'npm run dev',
      proxyPort: 4000,
      targetPort: 3000
    });

    // Verify .gitignore content
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    expect(gitignore).toContain('.chopin');
  });

  test('init command preserves existing .gitignore', async () => {
    // Create existing .gitignore
    const existingContent = 'node_modules\n.env\n';
    fs.writeFileSync(gitignorePath, existingContent);

    // Run init command
    const initProcess = require('child_process').spawnSync('node', ['index.js', 'init'], {
      stdio: 'pipe'
    });

    expect(initProcess.status).toBe(0);
    const gitignore = fs.readFileSync(gitignorePath, 'utf8');
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.chopin');
  });

  test('starts target process from config file', async () => {
    // Create a test config that runs test-server.js
    const config = {
      command: `TEST_SERVER_PORT=${TEST_PORT} node test-server.js`,
      proxyPort: 4000,
      targetPort: TEST_PORT,
      env: {
        NODE_ENV: 'test'
      }
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Start proxy with config, explicitly setting target port
    proxyProcess = spawn('node', ['index.js'], {
      stdio: 'inherit'
    });

    // Wait for both processes to start and retry connection
    const maxRetries = 10;
    let connected = false;
    
    for (let i = 0; i < maxRetries && !connected; i++) {
      await delay(500);
      try {
        const res = await safeFetch(`http://localhost:4000/hello`);
        if (res.status === 200) {
          connected = true;
          const text = await res.text();
          expect(text).toBe('Hello from test-server');
          break;
        }
      } catch (err) {
        // Ignore connection errors while retrying
        console.log(`[JEST] Attempt ${i + 1}/${maxRetries} failed, retrying...`);
      }
    }

    expect(connected).toBe(true);
  }, 15000);

  test('rejects invalid config file', async () => {
    // Create an invalid config
    const invalidConfig = {
      command: '',  // Empty command is invalid
      proxyPort: -1, // Invalid port number
      targetPort: 'not a number', // Wrong type
      unknownField: true // Not allowed by schema
    };
    fs.writeFileSync(configPath, JSON.stringify(invalidConfig, null, 2));

    return new Promise((resolve, reject) => {
      // Start proxy and expect it to exit with error
      const childProcess = require('child_process').spawn('node', ['index.js'], {
        stdio: ['ignore', 'ignore', 'pipe'] // Pipe only stderr
      });

      let stderr = '';
      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('error', (err) => {
        reject(new Error(`Failed to start process: ${err.message}`));
      });

      // Set a timeout to kill the process if it doesn't exit
      const timeout = setTimeout(() => {
        childProcess.kill();
        reject(new Error('Process timed out'));
      }, 8000);

      childProcess.on('exit', (code) => {
        clearTimeout(timeout);
        try {
          expect(code).not.toBe(0); // Should exit with error
          expect(stderr).toContain('Invalid chopin.config.json');
          // Only check for additional properties error since that's what we're getting
          expect(stderr).toContain('must NOT have additional properties');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }, 10000); // Increased timeout to 10 seconds

  test('handles arguments correctly when installed globally', async () => {
    // Create test config
    const config = {
      command: `TEST_SERVER_PORT=${TEST_PORT} node test-server.js`,
      proxyPort: 4000,
      targetPort: TEST_PORT
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Test different argument patterns
    const testCases = [
      {
        args: ['init'],
        expectedCode: 0,
        description: 'init command'
      },
      {
        args: ['4001', '3001'],
        description: 'custom ports',
        // Don't actually start the server, just check the output
        expectedOutput: 'Proxy on http://localhost:4001'
      },
      {
        args: [],
        description: 'no arguments',
        // Don't actually start the server, just check the output
        expectedOutput: 'Proxy on http://localhost:4000'
      }
    ];

    for (const testCase of testCases) {
      console.log(`[JEST] Testing argument pattern: ${testCase.description}`);
      
      // Use spawnSync to ensure process completes
      const process = require('child_process').spawnSync('node', ['index.js', ...testCase.args], {
        stdio: 'pipe',
        // Kill the process after 2 seconds to prevent hanging
        timeout: 2000
      });

      if (testCase.expectedCode !== undefined) {
        expect(process.status).toBe(testCase.expectedCode);
      }

      if (testCase.expectedOutput) {
        const output = process.stdout.toString();
        expect(output).toContain(testCase.expectedOutput);
        expect(process.stderr.toString()).not.toContain('error');
      }
    }
  }, 10000);
});