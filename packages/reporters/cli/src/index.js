// @flow strict-local

// $FlowFixMe This is fine.
const isTTY = false; // process.stdout.isTTY;

export default isTTY
  ? require('./CLIReporter').default
  : require('./SimpleCLIReporter').default;
