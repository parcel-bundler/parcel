// @flow strict-local

// $FlowFixMe This is fine.
const isTTY = process.stdout.isTTY;

export default (isTTY
  ? require('./CLIReporter').default
  : require('./SimpleCLIReporter').default);
