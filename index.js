#!/usr/bin/env node

// Check if we should delegate to locally installed version
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Check if we're running in a test environment
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

// Function to check if we're running from a local installation
function isRunningGlobally() {
  // If this script is being executed from node_modules/.bin/chopd in the current project,
  // it's already the local version
  const executingScript = process.argv[1];
  const cwd = process.cwd();
  const localBinPath = path.join(cwd, "node_modules", ".bin", "chopd");
  
  // On Windows the path might use different separators
  const normalizedExecutingScript = executingScript.replace(/\\/g, "/");
  const normalizedLocalBinPath = localBinPath.replace(/\\/g, "/");
  
  return !normalizedExecutingScript.includes(normalizedLocalBinPath);
}

// Check if there's a locally installed version
function findLocalInstallation() {
  try {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (deps.chopd) {
        const localChopdPath = path.join(process.cwd(), "node_modules", ".bin", "chopd");
        if (fs.existsSync(localChopdPath)) {
          return localChopdPath;
        }
      }
    }
  } catch (err) {
    // If there's an error, just continue with global version
    console.error(`Warning: Error checking for local chopd installation: ${err.message}`);
  }
  return null;
}

// Check if we should delegate to a local installation - skip in test environment
if (!isTestEnvironment && isRunningGlobally()) {
  const localChopdPath = findLocalInstallation();
  if (localChopdPath) {
    // We're running the global version but a local version exists, delegate to it
    console.log("Using locally installed chopd");
    const result = spawnSync(localChopdPath, process.argv.slice(2), {
      stdio: "inherit",
      shell: process.platform === "win32", // Use shell on Windows
    });
    process.exit(result.status);
  }
}

// Ensure fetch is available
if (typeof fetch !== "function") {
  console.error(
    "[ERROR] Built-in fetch not found. Use Node 20 or Node 18 w/ --experimental-fetch",
  );
  process.exit(1);
}

// Import utilities
const { parseArgs } = require("./src/utils/args");
const { loadConfig } = require("./src/utils/config");
const { executeCommand } = require("./src/commands");
const {
  startTargetProcess,
  setupCleanupHandlers,
} = require("./src/utils/process-manager");
const createApp = require("./src/app");

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
