#!/usr/bin/env node

/**
 * Schema Version Bumping Script
 * 
 * This script helps manage schema versions by:
 * 1. Creating a new schema file with the bumped version
 * 2. Updating the versions.json file with the new version
 * 3. Updating the compatibility mapping
 * 4. Updating the README.md compatibility table (optional)
 * 
 * Usage:
 *   node scripts/bump-schema-version.js <bump-type> [--chopd-version <version>] [--test]
 * 
 * Where <bump-type> is one of:
 *   - major: Increment the major version (breaking changes)
 *   - minor: Increment the minor version (backward-compatible features)
 *   - patch: Increment the patch version (backward-compatible fixes)
 * 
 * Options:
 *   --chopd-version <version>: Specify the chopd version for compatibility mapping
 *   --test: Run in test mode (doesn't actually change files)
 * 
 * Example:
 *   node scripts/bump-schema-version.js minor --chopd-version 0.0.7
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

// Parse arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Error: Please specify the bump type (major, minor, or patch)');
  process.exit(1);
}

const bumpType = args[0].toLowerCase();
if (!['major', 'minor', 'patch'].includes(bumpType)) {
  console.error('Error: Bump type must be one of: major, minor, patch');
  process.exit(1);
}

// Check if running in test mode
const isTestMode = args.includes('--test');
if (isTestMode) {
  console.log('Running in TEST MODE - No actual files will be modified');
}

// Get chopd version if provided
let chopdVersion = '';
const chopdVersionIndex = args.indexOf('--chopd-version');
if (chopdVersionIndex !== -1 && args.length > chopdVersionIndex + 1) {
  chopdVersion = args[chopdVersionIndex + 1];
  if (!semver.valid(chopdVersion)) {
    console.error(`Error: Invalid chopd version "${chopdVersion}". Please provide a valid semver version.`);
    process.exit(1);
  }
} else {
  // Try to read from package.json
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    chopdVersion = packageJson.version;
    console.log(`Using chopd version ${chopdVersion} from package.json`);
  } catch (err) {
    console.error('Error: Could not determine chopd version. Please provide it with --chopd-version');
    process.exit(1);
  }
}

// Paths
const versionsPath = path.join(__dirname, '../versions.json');
const schemasDir = path.join(__dirname, '../schemas');
const readmePath = path.join(__dirname, '../README.md');

// If test mode, create a temporary versions file for testing
const tempVersionsPath = path.join(__dirname, '../versions.test.json');
const actualVersionsPath = isTestMode ? tempVersionsPath : versionsPath;

// Load versions.json
let versionInfo;
try {
  // Read the original versions file
  const versionContent = fs.readFileSync(versionsPath, 'utf8');
  versionInfo = JSON.parse(versionContent);

  // If in test mode, write a copy for testing
  if (isTestMode) {
    fs.writeFileSync(tempVersionsPath, versionContent);
    console.log(`Created temporary versions file for testing: ${tempVersionsPath}`);
  }
} catch (err) {
  console.error(`Error reading versions.json: ${err.message}`);
  process.exit(1);
}

// Get current version and calculate new version
const currentVersion = versionInfo.current;
const newVersion = semver.inc(currentVersion, bumpType);
console.log(`Bumping schema version from ${currentVersion} to ${newVersion} (${bumpType})`);

// Define paths for current and new schema files
const currentSchemaPath = path.join(schemasDir, `schema_${currentVersion}.json`);
const newSchemaPath = path.join(schemasDir, `schema_${newVersion}.json`);

// Ensure schemas directory exists
if (!fs.existsSync(schemasDir)) {
  if (!isTestMode) {
    fs.mkdirSync(schemasDir, { recursive: true });
  }
  console.log(`Created schemas directory: ${schemasDir}`);
}

// Step 1: Create a copy of the current schema with the new version
if (!fs.existsSync(currentSchemaPath)) {
  console.error(`Error: Current schema file not found: ${currentSchemaPath}`);
  process.exit(1);
}

try {
  // Read the current schema
  const schemaContent = JSON.parse(fs.readFileSync(currentSchemaPath, 'utf8'));
  
  // Update the version inside the schema file
  schemaContent.version = newVersion;
  
  // Update default version in the properties
  if (schemaContent.properties && schemaContent.properties.version) {
    schemaContent.properties.version.default = newVersion;
    
    // Update example in the description if present
    if (schemaContent.properties.version.description) {
      schemaContent.properties.version.description = 
        schemaContent.properties.version.description.replace(
          /e\.g\.\s+[\d\.]+/,
          `e.g. ${newVersion}`
        );
    }
  }
  
  // Write the new schema file if not in test mode
  if (!isTestMode) {
    fs.writeFileSync(newSchemaPath, JSON.stringify(schemaContent, null, 2));
  }
  console.log(`${isTestMode ? '[TEST] Would create' : 'Created'} new schema file: ${newSchemaPath}`);
} catch (err) {
  console.error(`Error creating new schema file: ${err.message}`);
  process.exit(1);
}

// Step 2: Update versions.json file
try {
  // Update the versions info object
  versionInfo.current = newVersion;
  
  // Add to compatibility mapping if not already there
  if (!versionInfo.compatibility[newVersion]) {
    versionInfo.compatibility[newVersion] = chopdVersion;
  }
  
  // Add to history
  versionInfo.history.unshift({
    version: newVersion,
    released: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    changes: `Version ${newVersion} created by bump-schema-version script`
  });
  
  // Write the updated versions file if not in test mode
  if (!isTestMode) {
    fs.writeFileSync(actualVersionsPath, JSON.stringify(versionInfo, null, 2));
  }
  console.log(`${isTestMode ? '[TEST] Would update' : 'Updated'} versions.json with new version: ${newVersion}`);
} catch (err) {
  console.error(`Error updating versions.json: ${err.message}`);
  process.exit(1);
}

// Step 3: Update README.md compatibility table
try {
  let readmeContent = fs.readFileSync(readmePath, 'utf8');
  
  // Find the compatibility table
  const tableRegex = /([\s\S]*?\| Schema Version \| Compatible chopd Versions \|[\s\S]*?\|\s*-+\s*\|\s*-+\s*\|)([\s\S]*?)(\n\n)/m;
  const match = readmeContent.match(tableRegex);
  
  if (match) {
    const [fullMatch, tableHeader, tableRows, tableEnd] = match;
    
    // Check if this version is already in the table
    if (!tableRows.includes(`| ${newVersion}`)) {
      // Add the new version row
      const newRow = `\n| ${newVersion}          | ${chopdVersion}+                   |`;
      const newTable = `${tableHeader}${tableRows}${newRow}${tableEnd}`;
      
      // Replace the table in the README
      const updatedReadme = readmeContent.replace(tableRegex, newTable);
      
      // Also update the current schema version text if present
      const versionTextUpdated = updatedReadme.replace(
        /current schema version is (`|")[\d\.]+(`|")/,
        `current schema version is $1${newVersion}$2`
      );
      
      // Write the updated README if not in test mode
      if (!isTestMode) {
        fs.writeFileSync(readmePath, versionTextUpdated);
      }
      console.log(`${isTestMode ? '[TEST] Would update' : 'Updated'} README.md compatibility table with new version: ${newVersion}`);
    } else {
      console.log(`README.md already contains entry for version ${newVersion}, no update needed`);
    }
  } else {
    console.log('Could not locate compatibility table in README.md. Please update it manually.');
  }
} catch (err) {
  console.error(`Error updating README.md: ${err.message}`);
  console.error('Please update the README.md compatibility table manually.');
}

// Cleanup test file if in test mode
if (isTestMode) {
  try {
    fs.unlinkSync(tempVersionsPath);
    console.log(`Cleaned up temporary test file: ${tempVersionsPath}`);
  } catch (err) {
    console.error(`Warning: Could not clean up test file: ${err.message}`);
  }
}

console.log(`
${isTestMode ? '[TEST] Schema version bump simulation complete!' : 'Schema version bump complete!'}

Summary:
- Bumped schema version from ${currentVersion} to ${newVersion}
${isTestMode ? '- [TEST] Would create' : '- Created'} new schema file: schemas/schema_${newVersion}.json
${isTestMode ? '- [TEST] Would update' : '- Updated'} versions.json
${isTestMode ? '- [TEST] Would update' : '- Updated'} README.md compatibility table

${isTestMode ? 'No actual files were modified.' : 'Next steps:'}
${!isTestMode ? '1. Review and modify the new schema if needed\n2. Commit the changes' : ''}
`); 