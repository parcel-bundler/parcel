const WorkerFarm = require(`../../../${
  parseInt(process.versions.node, 10) < 8 ? 'lib' : 'src'
}/WorkerFarm`);

function run(a, b) {
  return WorkerFarm.callMaster({
    location: require.resolve('./master-sum.js'),
    args: [a, b]
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;
