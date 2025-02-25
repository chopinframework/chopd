const { spawn } = require("child-process-promise");

// Check if we're running in a test environment
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

// Store cleanup handlers so they can be removed
const cleanupHandlers = [];

/**
 * Start the target process based on config
 * @param {Object} config - The loaded config
 * @returns {Promise} Child process promise
 */
function startTargetProcess(config) {
  if (!config || !config.command) {
    return null;
  }

  // In test environment, don't start a real process if not needed
  if (isTestEnvironment && process.env.CHOPD_NO_PROCESS) {
    console.log(`[TEST] Would start target process: ${config.command}`);
    return null;
  }

  console.log(`Starting target process: ${config.command}`);
  const [cmd, ...args] = config.command.split(" ");

  const targetProcess = spawn(cmd, args, {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      ...(config.env || {}),
    },
  }).catch((err) => {
    console.error("Failed to start target process:", err.message);
    process.exit(1);
  });

  return targetProcess;
}

/**
 * Setup process cleanup handlers
 * @param {Object} targetProcess - The process to clean up
 */
function setupCleanupHandlers(targetProcess) {
  if (!targetProcess) return;

  const cleanup = () => {
    console.log("\nShutting down...");
    if (targetProcess && targetProcess.childProcess) {
      console.log("Stopping target process...");
      targetProcess.childProcess.kill();
    }
    process.exit(0);
  };

  // Store references to cleanup handlers so they can be removed
  cleanupHandlers.push(cleanup);

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

/**
 * Remove all cleanup handlers
 * Used in tests to prevent Jest from hanging
 */
function removeCleanupHandlers() {
  cleanupHandlers.forEach(handler => {
    process.removeListener("SIGINT", handler);
    process.removeListener("SIGTERM", handler);
  });
  // Clear the array
  cleanupHandlers.length = 0;
}

module.exports = {
  startTargetProcess,
  setupCleanupHandlers,
  removeCleanupHandlers
};
