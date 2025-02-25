const init = require("./init");

const commands = {
  init,
};

/**
 * Execute a command
 * @param {string} commandName - Name of the command to execute
 * @param {Array} args - Command arguments
 * @returns {boolean} Whether the command was found and executed
 */
function executeCommand(commandName, args) {
  if (commands[commandName]) {
    commands[commandName](args);
    return true;
  }
  return false;
}

module.exports = {
  executeCommand,
};
