// Node 8 supports native async functions - no need to use compiled code!
exports.promisify =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/promisify')
    : require('./src/promisify');
