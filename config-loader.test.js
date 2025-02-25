const fs = require('fs');
const path = require('path');
const semver = require('semver');

// Path to the versions.json file
const VERSIONS_PATH = path.join(__dirname, 'versions.json');

describe('Schema Version Config Tests', () => {
  // Test that versions.json has the expected structure
  test('versions.json has the correct structure', () => {
    const versionsContent = fs.readFileSync(VERSIONS_PATH, 'utf8');
    const versionInfo = JSON.parse(versionsContent);
    
    // Check structure
    expect(versionInfo).toHaveProperty('current');
    expect(versionInfo).toHaveProperty('minimum');
    expect(versionInfo).toHaveProperty('compatibility');
    expect(versionInfo).toHaveProperty('history');
    
    // Check types
    expect(typeof versionInfo.current).toBe('string');
    expect(typeof versionInfo.minimum).toBe('string');
    expect(typeof versionInfo.compatibility).toBe('object');
    expect(Array.isArray(versionInfo.history)).toBe(true);
    
    // Check semver validity
    expect(semver.valid(versionInfo.current)).toBeTruthy();
    expect(semver.valid(versionInfo.minimum)).toBeTruthy();
    
    // Check compatibility structure
    expect(versionInfo.compatibility[versionInfo.current]).toBeTruthy();
    
    // Check history structure
    expect(versionInfo.history.length).toBeGreaterThan(0);
    expect(versionInfo.history[0]).toHaveProperty('version');
    expect(versionInfo.history[0]).toHaveProperty('released');
    expect(versionInfo.history[0]).toHaveProperty('changes');
  });
  
  // Test semver compatibility rules
  test('semver compatibility logic works correctly', () => {
    const versionContent = fs.readFileSync(VERSIONS_PATH, 'utf8');
    const versionInfo = JSON.parse(versionContent);
    const minVersion = versionInfo.minimum;
    
    // Function to check semver compatibility (similar to what's in config.js)
    function isCompatible(version) {
      return semver.gte(version, minVersion) && 
             semver.satisfies(version, `^${minVersion}`);
    }
    
    // Current version should be compatible
    expect(isCompatible(versionInfo.current)).toBe(true);
    
    // Same major.minor with higher patch should be compatible
    const higherPatch = semver.inc(versionInfo.current, 'patch');
    expect(isCompatible(higherPatch)).toBe(true);
    
    // Check if current is already 0.x.y
    if (semver.major(versionInfo.current) === 0) {
      // For 0.x.y versions, semver treats minor as breaking changes:
      // "^0.x.y" compatibility allows only patch increases
      const higherMinor = semver.inc(versionInfo.current, 'minor');
      expect(isCompatible(higherMinor)).toBe(false);
    } else {
      // For 1.x.y+ versions, "^1.x.y" allows minor increases
      const higherMinor = semver.inc(versionInfo.current, 'minor');
      expect(isCompatible(higherMinor)).toBe(true);
    }
    
    // Higher major should not be compatible
    const higherMajor = semver.inc(versionInfo.current, 'major');
    expect(isCompatible(higherMajor)).toBe(false);
    
    // Lower major should not be compatible (only if major > 0)
    const currentMajor = semver.major(versionInfo.current);
    if (currentMajor > 0) {
      const lowerMajor = `${currentMajor - 1}.0.0`;
      expect(isCompatible(lowerMajor)).toBe(false);
    }
    
    // Very old version should not be compatible
    expect(isCompatible('0.0.1')).toBe(false);
  });
  
  // Check that config.js loads the version information correctly
  test('config.js loads version information from versions.json', () => {
    jest.resetModules();
    
    // Get the version info directly from versions.json
    const versionContent = fs.readFileSync(VERSIONS_PATH, 'utf8');
    const versionInfo = JSON.parse(versionContent);
    
    // Load the actual config module to test its behavior
    try {
      const configModule = require('./src/utils/config');
      
      // Check that it has the expected keys
      expect(configModule).toHaveProperty('CURRENT_SCHEMA_VERSION');
      expect(typeof configModule.CURRENT_SCHEMA_VERSION).toBe('string');
      
      // Check the value matches
      expect(configModule.CURRENT_SCHEMA_VERSION).toBe(versionInfo.current);
    } catch (err) {
      // If the module fails to load, we'll fail the test with a helpful message
      fail(`Failed to load config module: ${err.message}`);
    }
  });
}); 