/**
 * Parse command line arguments
 * @param {string[]} argv - Process arguments array
 * @returns {Object} Parsed arguments
 */
function parseArgs(argv) {
  // Remove node and script path
  const args = argv.slice(2);
  
  // Handle commands
  if (args[0] && !args[0].startsWith('-') && isNaN(args[0])) {
    return {
      command: args[0],
      args: args.slice(1)
    };
  }

  // Handle port arguments
  return {
    command: null,
    proxyPort: args[0] ? parseInt(args[0], 10) : null,
    targetPort: args[1] ? parseInt(args[1], 10) : null
  };
}

module.exports = {
  parseArgs
}; 