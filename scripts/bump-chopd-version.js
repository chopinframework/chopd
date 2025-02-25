#!/usr/bin/env node

/**
 * Chopd Version Bumping Script
 *
 * This script manages the chopd application version by:
 * 1. Updating the version in package.json
 * 2. Updating the compatibility mapping in versions.json
 * 3. Updating the README.md compatibility table
 *
 * Usage:
 *   node scripts/bump-chopd-version.js <bump-type> [--schema-versions <versions>] [--test]
 *
 * Where <bump-type> is one of:
 *   - major: Increment the major version (breaking changes)
 *   - minor: Increment the minor version (backward-compatible features)
 *   - patch: Increment the patch version (backward-compatible fixes)
 *
 * Options:
 *   --schema-versions <versions>: Comma-separated list of schema versions that should be compatible with the new chopd version
 *                                 If not specified, all currently compatible schema versions will remain compatible
 *   --test: Run in test mode (doesn't actually change files)
 *
 * Example:
 *   node scripts/bump-chopd-version.js minor --schema-versions 0.1.0,0.1.1
 */

const fs = require("fs");
const path = require("path");
const semver = require("semver");

// Parse arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Error: Please specify the bump type (major, minor, or patch)");
  process.exit(1);
}

const bumpType = args[0].toLowerCase();
if (!["major", "minor", "patch"].includes(bumpType)) {
  console.error("Error: Bump type must be one of: major, minor, patch");
  process.exit(1);
}

// Check if running in test mode
const isTestMode = args.includes("--test");
if (isTestMode) {
  console.log("Running in TEST MODE - No actual files will be modified");
}

// Get schema versions if provided
let schemaVersions = [];
const schemaVersionsIndex = args.indexOf("--schema-versions");
if (schemaVersionsIndex !== -1 && args.length > schemaVersionsIndex + 1) {
  schemaVersions = args[schemaVersionsIndex + 1]
    .split(",")
    .map((v) => v.trim());

  // Validate schema versions
  for (const version of schemaVersions) {
    if (!semver.valid(version)) {
      console.error(
        `Error: Invalid schema version "${version}". Please provide valid semver versions.`,
      );
      process.exit(1);
    }
  }
}

// Paths
const packagePath = path.join(__dirname, "../package.json");
const versionsPath = path.join(__dirname, "../versions.json");
const readmePath = path.join(__dirname, "../README.md");

// If test mode, create temporary files for testing
const tempPackagePath = path.join(__dirname, "../package.test.json");
const tempVersionsPath = path.join(__dirname, "../versions.test.json");
const tempReadmePath = path.join(__dirname, "../README.test.md");

const actualPackagePath = isTestMode ? tempPackagePath : packagePath;
const actualVersionsPath = isTestMode ? tempVersionsPath : versionsPath;
const actualReadmePath = isTestMode ? tempReadmePath : readmePath;

// Load package.json
let packageInfo;
try {
  // Read the original package.json
  const packageContent = fs.readFileSync(packagePath, "utf8");
  packageInfo = JSON.parse(packageContent);

  // If in test mode, write a copy for testing
  if (isTestMode) {
    fs.writeFileSync(tempPackagePath, packageContent);
    console.log(
      `Created temporary package.json for testing: ${tempPackagePath}`,
    );
  }
} catch (err) {
  console.error(`Error reading package.json: ${err.message}`);
  process.exit(1);
}

// Load versions.json
let versionInfo;
try {
  // Read the original versions file
  const versionContent = fs.readFileSync(versionsPath, "utf8");
  versionInfo = JSON.parse(versionContent);

  // If in test mode, write a copy for testing
  if (isTestMode) {
    fs.writeFileSync(tempVersionsPath, versionContent);
    console.log(
      `Created temporary versions.json for testing: ${tempVersionsPath}`,
    );
  }
} catch (err) {
  console.error(`Error reading versions.json: ${err.message}`);
  process.exit(1);
}

// Load README.md
let readmeContent;
try {
  // Read the original README
  readmeContent = fs.readFileSync(readmePath, "utf8");

  // If in test mode, write a copy for testing
  if (isTestMode) {
    fs.writeFileSync(tempReadmePath, readmeContent);
    console.log(`Created temporary README.md for testing: ${tempReadmePath}`);
  }
} catch (err) {
  console.error(`Error reading README.md: ${err.message}`);
  process.exit(1);
}

// Get current chopd version and calculate new version
const currentVersion = packageInfo.version;
const newVersion = semver.inc(currentVersion, bumpType);
console.log(
  `Bumping chopd version from ${currentVersion} to ${newVersion} (${bumpType})`,
);

// Step 1: Update package.json
try {
  // Update the version in package.json
  packageInfo.version = newVersion;

  // Write the updated package.json if not in test mode
  if (!isTestMode) {
    fs.writeFileSync(
      actualPackagePath,
      JSON.stringify(packageInfo, null, 2) + "\n",
    );
  }
  console.log(
    `${isTestMode ? "[TEST] Would update" : "Updated"} package.json with new version: ${newVersion}`,
  );
} catch (err) {
  console.error(`Error updating package.json: ${err.message}`);
  process.exit(1);
}

// Step 2: Update versions.json file (compatibility mapping)
try {
  // If no specific schema versions are specified, use all existing schema versions
  // that are currently compatible with the old chopd version
  if (schemaVersions.length === 0) {
    Object.entries(versionInfo.compatibility).forEach(
      ([schemaVersion, chopdVersion]) => {
        if (
          chopdVersion === currentVersion ||
          chopdVersion.endsWith(`${currentVersion}+`)
        ) {
          schemaVersions.push(schemaVersion);
        }
      },
    );

    if (schemaVersions.length === 0) {
      // If still no schema versions, use the current schema version
      schemaVersions.push(versionInfo.current);
    }

    console.log(
      `No specific schema versions provided. Using: ${schemaVersions.join(", ")}`,
    );
  }

  // Update the compatibility mapping for each specified schema version
  for (const schemaVersion of schemaVersions) {
    // If this schema version doesn't exist in the compatibility mapping,
    // check if it's a valid schema version first
    if (!versionInfo.compatibility[schemaVersion]) {
      // Only allow known schema versions or the current schema version
      if (
        schemaVersion !== versionInfo.current &&
        !versionInfo.history.some((h) => h.version === schemaVersion)
      ) {
        console.warn(
          `Warning: Schema version ${schemaVersion} is not recognized in version history. Adding anyway.`,
        );
      }
    }

    // Update the compatibility mapping to use the new chopd version with a "+" suffix
    // to indicate that this schema version is compatible with this chopd version and higher
    versionInfo.compatibility[schemaVersion] = `${newVersion}+`;
  }

  // Write the updated versions.json file if not in test mode
  if (!isTestMode) {
    fs.writeFileSync(
      actualVersionsPath,
      JSON.stringify(versionInfo, null, 2) + "\n",
    );
  }
  console.log(
    `${isTestMode ? "[TEST] Would update" : "Updated"} versions.json compatibility mapping for schema versions: ${schemaVersions.join(", ")}`,
  );
} catch (err) {
  console.error(`Error updating versions.json: ${err.message}`);
  process.exit(1);
}

// Step 3: Update README.md
try {
  // Find and update the compatibility table in README.md
  const tableRegex =
    /([\s\S]*?\| Schema Version \| Compatible chopd Versions \|[\s\S]*?\|\s*-+\s*\|\s*-+\s*\|)([\s\S]*?)(\n\n)/m;
  const match = readmeContent.match(tableRegex);

  if (match) {
    const [fullMatch, tableHeader, tableRows, tableEnd] = match;
    let updatedTableRows = tableRows;

    // Update the compatibility information for each schema version
    for (const schemaVersion of schemaVersions) {
      const schemaVersionRow = new RegExp(
        `\\| ${schemaVersion}\\s*\\|\\s*[^\\|]*\\|`,
        "m",
      );

      if (tableRows.match(schemaVersionRow)) {
        // Update existing row
        updatedTableRows = updatedTableRows.replace(
          schemaVersionRow,
          `| ${schemaVersion}          | ${newVersion}+                   |`,
        );
      } else {
        // Add new row
        updatedTableRows += `\n| ${schemaVersion}          | ${newVersion}+                   |`;
      }
    }

    // Replace the table in the README
    const newTable = `${tableHeader}${updatedTableRows}${tableEnd}`;
    let updatedReadme = readmeContent.replace(tableRegex, newTable);

    // Also update the chopd version references in the README
    updatedReadme = updatedReadme.replace(
      /chopd version (`|")[\d\.]+(`|")/g,
      `chopd version $1${newVersion}$2`,
    );

    // Write the updated README if not in test mode
    if (!isTestMode) {
      fs.writeFileSync(actualReadmePath, updatedReadme);
    }
    console.log(
      `${isTestMode ? "[TEST] Would update" : "Updated"} README.md with new chopd version: ${newVersion}`,
    );
  } else {
    console.log(
      "Could not locate compatibility table in README.md. Please update it manually.",
    );
  }
} catch (err) {
  console.error(`Error updating README.md: ${err.message}`);
  console.error("Please update the README.md compatibility table manually.");
}

// Cleanup temporary files if in test mode
if (isTestMode) {
  try {
    fs.unlinkSync(tempPackagePath);
    fs.unlinkSync(tempVersionsPath);
    fs.unlinkSync(tempReadmePath);
    console.log("Cleaned up temporary test files");
  } catch (err) {
    console.error(`Warning: Could not clean up test files: ${err.message}`);
  }
}

console.log(`
${isTestMode ? "[TEST] Chopd version bump simulation complete!" : "Chopd version bump complete!"}

Summary:
- Bumped chopd version from ${currentVersion} to ${newVersion}
${isTestMode ? "- [TEST] Would update" : "- Updated"} package.json
${isTestMode ? "- [TEST] Would update" : "- Updated"} versions.json compatibility mapping
${isTestMode ? "- [TEST] Would update" : "- Updated"} README.md compatibility table

${isTestMode ? "No actual files were modified." : "Next steps:"}
${!isTestMode ? "1. Review the changes\n2. Run tests to verify everything works\n3. Commit the changes" : ""}
`);
