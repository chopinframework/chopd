const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const semver = require('semver');

// Current supported schema version - update this when releasing new schema versions
const CURRENT_SCHEMA_VERSION = '0.1.0';
// Minimum compatible schema version
const MIN_SCHEMA_VERSION = '0.1.0';

// Map of schema versions to chopd versions
const SCHEMA_COMPATIBILITY = {
  '0.1.0': '0.0.6' // Current chopd version
};

/**
 * Get the schema file path for a given version
 * @param {string} version - Schema version
 * @returns {string} - Path to the schema file
 */
function getSchemaPath(version) {
  return path.join(__dirname, `../../schemas/schema_${version}.json`);
}

/**
 * Check if the config version is compatible with the current version
 * @param {string} configVersion - Version from config file
 * @returns {boolean} - Whether the version is compatible
 */
function isVersionCompatible(configVersion) {
  // For simple semver compatibility check
  return semver.gte(configVersion, MIN_SCHEMA_VERSION) && 
         semver.satisfies(configVersion, `^${MIN_SCHEMA_VERSION}`);
}

/**
 * Get the chopd version compatible with a schema version
 * @param {string} schemaVersion - Schema version
 * @returns {string|null} - Compatible chopd version or null if not found
 */
function getCompatibleChopdVersion(schemaVersion) {
  return SCHEMA_COMPATIBILITY[schemaVersion] || null;
}

/**
 * Load and validate config file
 * @returns {Object|null} The validated config or null
 */
function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'chopin.config.json');
    
    if (fs.existsSync(configPath)) {
      // Load config first to determine which schema to use
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Check if version exists
      if (!config.version) {
        console.warn('No version specified in chopin.config.json, assuming version 0.1.0');
        config.version = '0.1.0';
      }
      
      // Check version compatibility
      if (!isVersionCompatible(config.version)) {
        console.error(`Config version ${config.version} is not compatible with the current schema version ${CURRENT_SCHEMA_VERSION}`);
        
        const compatibleChopdVersion = getCompatibleChopdVersion(config.version);
        if (compatibleChopdVersion) {
          console.error(`This config file is compatible with chopd version ${compatibleChopdVersion}`);
          console.error(`You can either:
1. Update your config to version ${CURRENT_SCHEMA_VERSION}, or
2. Use chopd version ${compatibleChopdVersion} with your current config`);
        } else {
          console.error(`Please update your chopin.config.json to use version ${CURRENT_SCHEMA_VERSION} or higher`);
        }
        
        process.exit(1);
      }
      
      // Determine which schema to use based on config version
      const schemaPath = getSchemaPath(config.version);
      
      if (!fs.existsSync(schemaPath)) {
        console.error(`Schema file for version ${config.version} not found at ${schemaPath}`);
        console.error(`Available schemas: ${fs.readdirSync(path.join(__dirname, '../../schemas'))
          .filter(file => file.startsWith('schema_'))
          .map(file => file.replace('schema_', '').replace('.json', ''))
          .join(', ')}`);
        process.exit(1);
      }
      
      // Load and validate schema
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      
      // Validate against schema
      const ajv = new Ajv();
      const validate = ajv.compile(schema);
      const valid = validate(config);
      
      if (!valid) {
        console.error('Invalid chopin.config.json:');
        validate.errors.forEach(error => {
          console.error(`- ${error.instancePath} ${error.message}`);
        });
        process.exit(1);
      }
      
      console.log(`Found valid chopin.config.json (schema version ${config.version}):`);
      console.log(config);
      return config;
    }
  } catch (err) {
    console.error('Error reading/validating config:', err.message);
    process.exit(1);
  }
  
  return null;
}

module.exports = {
  loadConfig,
  CURRENT_SCHEMA_VERSION,
  getCompatibleChopdVersion
}; 