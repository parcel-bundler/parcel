module.exports =
  parseInt(process.versions.node, 10) < 8 ? require('./lib') : require('./src');
