const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

/**
 * Load and validate config file
 * @returns {Object|null} The validated config or null
 */
function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), 'chopin.config.json');
    const schemaPath = path.join(__dirname, '../../schema.json');
    
    if (fs.existsSync(configPath)) {
      // Load schema and config
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
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
      
      console.log('Found valid chopin.config.json:', config);
      return config;
    }
  } catch (err) {
    console.error('Error reading/validating config:', err.message);
    process.exit(1);
  }
  
  return null;
}

module.exports = {
  loadConfig
}; 