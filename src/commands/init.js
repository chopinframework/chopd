const fs = require('fs');
const path = require('path');

/**
 * Initialize a new Chopin project
 */
function init() {
  // Create .chopin directory
  const chopinDir = path.join(process.cwd(), '.chopin');
  if (!fs.existsSync(chopinDir)) {
    fs.mkdirSync(chopinDir);
  }

  // Create default config file if it doesn't exist
  const configPath = path.join(process.cwd(), 'chopin.config.json');
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      command: 'npm run dev',
      proxyPort: 4000,
      targetPort: 3000
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log('Created chopin.config.json with default settings');
  }

  // Update or create .gitignore
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  let gitignoreContent = '';
  
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  if (!gitignoreContent.includes('.chopin')) {
    gitignoreContent = gitignoreContent.trim() + '\n.chopin\n';
    fs.writeFileSync(gitignorePath, gitignoreContent);
    console.log('Added .chopin to .gitignore');
  }

  console.log('Initialization complete!');
}

module.exports = init; 