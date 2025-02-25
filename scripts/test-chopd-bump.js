#!/usr/bin/env node

/**
 * Test Script for Chopd Version Bumping
 *
 * This script tests the bump-chopd-version.js script by running it in test mode.
 * It will simulate bumping the chopd version without modifying any actual files.
 *
 * Usage:
 *   node scripts/test-chopd-bump.js
 */

const { spawnSync } = require("child_process");
const path = require("path");
const semver = require("semver");

console.log("Testing chopd version bump functionality...\n");

// Path to the bump script
const bumpScriptPath = path.join(__dirname, "bump-chopd-version.js");

// Test cases to run
const testCases = [
  {
    name: "Patch version bump",
    args: ["patch", "--test"],
  },
  {
    name: "Minor version bump",
    args: ["minor", "--test"],
  },
  {
    name: "Major version bump",
    args: ["major", "--test"],
  },
  {
    name: "Custom schema versions",
    args: ["patch", "--test", "--schema-versions", "0.1.0"],
  },
];

// Run each test case
let allPassed = true;
for (const testCase of testCases) {
  console.log(`\n=== Running test: ${testCase.name} ===`);

  // Run the bump script with the test arguments
  const result = spawnSync("node", [bumpScriptPath, ...testCase.args], {
    encoding: "utf8",
  });

  // Check if the script ran successfully
  if (result.status === 0) {
    console.log(`✅ Test "${testCase.name}" passed`);
    console.log(
      `Command executed: node ${bumpScriptPath} ${testCase.args.join(" ")}`,
    );

    // Log a brief summary of what was simulated
    const outputLines = result.stdout.split("\n");
    const versionLine = outputLines.find((line) =>
      line.includes("Bumping chopd version from"),
    );
    if (versionLine) {
      console.log(`  ${versionLine.trim()}`);
    }

    // Log any warnings
    const warnings = outputLines.filter((line) => line.includes("Warning"));
    if (warnings.length > 0) {
      console.log("  Warnings:");
      warnings.forEach((warning) => console.log(`  - ${warning.trim()}`));
    }
  } else {
    console.error(`❌ Test "${testCase.name}" failed`);
    console.error(`Command: node ${bumpScriptPath} ${testCase.args.join(" ")}`);
    console.error(`Exit code: ${result.status}`);
    console.error(`Error output:\n${result.stderr}`);
    allPassed = false;
  }
}

console.log("\n=== Test Summary ===");
if (allPassed) {
  console.log("✅ All tests passed successfully");
  console.log(
    "\nThe bump-chopd-version.js script is working properly in test mode.",
  );
  console.log("You can now use it to bump the actual chopd version:");
  console.log(
    "\n  node scripts/bump-chopd-version.js <patch|minor|major> [--schema-versions <versions>]",
  );
} else {
  console.error(
    "❌ Some tests failed. Please review the errors above and fix the issues.",
  );
  process.exit(1);
}
