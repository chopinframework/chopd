#!/usr/bin/env node

// Ensure fetch is available
if (typeof fetch !== 'function') {
  console.error('[ERROR] Built-in fetch not found. Use Node 20 or Node 18 w/ --experimental-fetch');
  process.exit(1);
}

// Import utilities
const { parseArgs } = require('./src/utils/args');
const { loadConfig } = require('./src/utils/config');
const { executeCommand } = require('./src/commands');
const { startTargetProcess, setupCleanupHandlers } = require('./src/utils/process-manager');
const createApp = require('./src/app');

// Parse arguments
const args = parseArgs(process.argv);

// Handle commands
if (args.command) {
  const success = executeCommand(args.command, args.args);
  if (success) {
    process.exit(0);
  } else {
    console.error(`Unknown command: ${args.command}`);
    process.exit(1);
  }
}

// Load configuration
const config = loadConfig();

// Determine ports
const PROXY_PORT = args.proxyPort || config?.proxyPort || 4000;
const TARGET_PORT = args.targetPort || config?.targetPort || 3000;

// Spawn target process if configured
const targetProcess = startTargetProcess(config);
setupCleanupHandlers(targetProcess);

// Create and start the app
const app = createApp(PROXY_PORT, TARGET_PORT);
app.listen(PROXY_PORT, () => {
  console.log(`Proxy on http://localhost:${PROXY_PORT} -> :${TARGET_PORT}`);
});