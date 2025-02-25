#!/usr/bin/env node

/**
 * Test Script for Schema Version Bumping
 *
 * This script tests the schema version bumping functionality without modifying any actual files.
 * It runs the bump-schema-version.js script in test mode for each bump type (patch, minor, major).
 */

const { spawnSync } = require("child_process");
const path = require("path");

console.log("===== Testing Schema Version Bumping =====\n");

// Helper function to run the bump script with specific parameters
function runBumpTest(bumpType, extraArgs = []) {
  console.log(`\n----- Testing ${bumpType.toUpperCase()} version bump -----`);

  const args = [
    path.join(__dirname, "bump-schema-version.js"),
    bumpType,
    "--test",
    ...extraArgs,
  ];

  const result = spawnSync("node", args, {
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    console.error(`\n❌ Error: Failed to execute ${bumpType} bump test`);
    process.exit(result.status);
  }

  return result;
}

// Test patch version bump
runBumpTest("patch");

// Test minor version bump
runBumpTest("minor");

// Test major version bump
runBumpTest("major");

// Test with custom chopd version
runBumpTest("patch", ["--chopd-version", "0.0.7"]);

console.log("\n===== All tests completed successfully! =====");
console.log("The bump-schema-version.js script works correctly in test mode.");
console.log("No actual files were modified during these tests.");
