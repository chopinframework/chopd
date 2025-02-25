const { spawn } = require("child-process-promise");

/**
 * Start the target process based on config
 * @param {Object} config - The loaded config
 * @returns {Promise} Child process promise
 */
function startTargetProcess(config) {
  if (!config || !config.command) {
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

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

module.exports = {
  startTargetProcess,
  setupCleanupHandlers,
};
