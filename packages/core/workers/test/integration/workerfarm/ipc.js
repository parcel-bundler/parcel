const WorkerFarm = require('../../../src/WorkerFarm').default;

function run(a, b) {
  return WorkerFarm.callMaster({
    location: require.resolve('./master-sum.js'),
    args: [a, b]
  });
}

exports.run = run;
