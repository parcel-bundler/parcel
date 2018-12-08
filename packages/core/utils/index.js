// Node 8 supports native async functions - no need to use compiled code!
exports.promisify =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/promisify')
    : require('./src/promisify');

exports.errorUtils =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/errorUtils')
    : require('./src/errorUtils');

exports.objectHash =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/objectHash')
    : require('./src/objectHash');

exports.md5 =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/md5')
    : require('./src/md5');

exports.isURL =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/is-url')
    : require('./src/is-url');

exports.glob =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/glob')
    : require('./src/glob');
