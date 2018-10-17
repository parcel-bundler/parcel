// Node 8 supports native async functions - no need to use compiled code!
module.exports =
  parseInt(process.versions.node, 10) < 8
    ? require('./lib/Logger')
    : require('./src/Logger');
