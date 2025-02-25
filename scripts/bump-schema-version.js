#!/usr/bin/env node

/**
 * Schema Version Bumping Script
 * 
 * This script helps manage schema versions by:
 * 1. Creating a new schema file with the bumped version
 * 2. Updating the config.js file with the new version
 * 3. Updating the compatibility mapping
 * 4. Updating the README.md compatibility table (optional)
 * 
 * Usage:
 *   node scripts/bump-schema-version.js <bump-type> [--chopd-version <version>]
 * 
 * Where <bump-type> is one of:
 *   - major: Increment the major version (breaking changes)
 *   - minor: Increment the minor version (backward-compatible features)
 *   - patch: Increment the patch version (backward-compatible fixes)
 * 
 * Example:
 *   node scripts/bump-schema-version.js minor --chopd-version 0.0.7
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

// Import the current version
const { CURRENT_SCHEMA_VERSION } = require('../src/utils/config');

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

// Calculate new version
const newVersion = semver.inc(CURRENT_SCHEMA_VERSION, bumpType);
console.log(`Bumping schema version from ${CURRENT_SCHEMA_VERSION} to ${newVersion} (${bumpType})`);

// Paths
const configPath = path.join(__dirname, '../src/utils/config.js');
const schemasDir = path.join(__dirname, '../schemas');
const currentSchemaPath = path.join(schemasDir, `schema_${CURRENT_SCHEMA_VERSION}.json`);
const newSchemaPath = path.join(schemasDir, `schema_${newVersion}.json`);
const readmePath = path.join(__dirname, '../README.md');

// Ensure schemas directory exists
if (!fs.existsSync(schemasDir)) {
  fs.mkdirSync(schemasDir, { recursive: true });
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
  
  // Write the new schema file
  fs.writeFileSync(newSchemaPath, JSON.stringify(schemaContent, null, 2));
  console.log(`Created new schema file: ${newSchemaPath}`);
} catch (err) {
  console.error(`Error creating new schema file: ${err.message}`);
  process.exit(1);
}

// Step 2: Update the config.js file
try {
  let configContent = fs.readFileSync(configPath, 'utf8');
  
  // Update CURRENT_SCHEMA_VERSION
  configContent = configContent.replace(
    /const CURRENT_SCHEMA_VERSION = ['"][\d\.]+['"]/,
    `const CURRENT_SCHEMA_VERSION = '${newVersion}'`
  );
  
  // Add to SCHEMA_COMPATIBILITY map
  configContent = configContent.replace(
    /(const SCHEMA_COMPATIBILITY = \{)([\s\S]*?)(\};)/m,
    (match, start, content, end) => {
      // Check if this version is already in the map
      if (content.includes(`'${newVersion}':`)) {
        return match; // Already exists, don't modify
      }
      
      // Add the new version mapping
      const newMapping = `\n  '${newVersion}': '${chopdVersion}', // Added by bump-schema-version script`;
      return `${start}${newMapping}${content}${end}`;
    }
  );
  
  fs.writeFileSync(configPath, configContent);
  console.log(`Updated config.js with new version: ${newVersion}`);
} catch (err) {
  console.error(`Error updating config.js: ${err.message}`);
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
      readmeContent = readmeContent.replace(tableRegex, newTable);
      
      // Also update the current schema version text if present
      readmeContent = readmeContent.replace(
        /current schema version is (`|")[\d\.]+(`|")/,
        `current schema version is $1${newVersion}$2`
      );
      
      fs.writeFileSync(readmePath, readmeContent);
      console.log(`Updated README.md compatibility table with new version: ${newVersion}`);
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

console.log(`
Schema version bump complete!

Summary:
- Bumped schema version from ${CURRENT_SCHEMA_VERSION} to ${newVersion}
- Created new schema file: schemas/schema_${newVersion}.json
- Updated CURRENT_SCHEMA_VERSION in src/utils/config.js
- Added new version to SCHEMA_COMPATIBILITY mapping
- Updated README.md compatibility table (if found)

Next steps:
1. Review and modify the new schema if needed
2. Commit the changes
3. When releasing a new version of chopd, update the SCHEMA_COMPATIBILITY mapping if needed
`); 