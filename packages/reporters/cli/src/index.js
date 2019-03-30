// @flow strict-local

// $FlowFixMe This is fine.
const isTTY = process.stdout.isTTY;

export default require('./SimpleCLIReporter')
  .default; /*(isTTY
  ? require('./CLIReporter').default
  : );*/
