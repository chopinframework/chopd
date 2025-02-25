const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { CURRENT_SCHEMA_VERSION } = require("../utils/config");

// Check if we're running in a test environment
const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

/**
 * Get the current chopd version
 * @returns {string} Current version
 */
function getCurrentChopdVersion() {
  try {
    const packagePath = path.join(__dirname, "../../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return packageJson.version;
  } catch (err) {
    console.error(`Error reading package.json: ${err.message}`);
    return null;
  }
}

/**
 * Initialize a new Chopin project
 */
function init() {
  // Get current chopd version
  const currentVersion = getCurrentChopdVersion();
  if (!currentVersion) {
    console.error("Failed to determine current chopd version");
    process.exit(1);
  }

  // Create .chopin directory
  const chopinDir = path.join(process.cwd(), ".chopin");
  if (!fs.existsSync(chopinDir)) {
    fs.mkdirSync(chopinDir);
  }

  // Create default config file if it doesn't exist
  const configPath = path.join(process.cwd(), "chopin.config.json");
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      version: CURRENT_SCHEMA_VERSION,
      command: "npm run dev",
      proxyPort: 4000,
      targetPort: 3000,
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(
      `Created chopin.config.json with schema version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  // Update or create .gitignore
  const gitignorePath = path.join(process.cwd(), ".gitignore");
  let gitignoreContent = "";

  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
  }

  if (!gitignoreContent.includes(".chopin")) {
    gitignoreContent = gitignoreContent.trim() + "\n.chopin\n";
    fs.writeFileSync(gitignorePath, gitignoreContent);
    console.log("Added .chopin to .gitignore");
  }

  // Install chopd as a dev dependency with exact version
  // Skip the actual installation in test environment
  if (!isTestEnvironment) {
    try {
      console.log(`Installing chopd@${currentVersion} as a dev dependency...`);
      execSync(`npm install --save-dev chopd@${currentVersion}`, {
        stdio: "inherit",
        cwd: process.cwd(),
      });
      console.log(`Successfully installed chopd@${currentVersion}`);
    } catch (err) {
      console.error(`Error installing chopd: ${err.message}`);
      console.log("Initialization completed, but couldn't install chopd locally.");
      console.log(`You can manually add it with: npm install --save-dev chopd@${currentVersion}`);
      // Don't exit with error in test environment
      if (!isTestEnvironment) {
        process.exit(1);
      }
    }
  } else {
    console.log(`[TEST MODE] Would install chopd@${currentVersion} as a dev dependency`);
  }

  console.log("Initialization complete!");
  console.log("In the future, you can run 'npx chopd' to use the locally installed version.");
}

module.exports = init;
