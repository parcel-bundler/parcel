const WorkerFarm = require(`../../../${
  parseInt(process.versions.node, 10) < 8 ? 'lib' : 'src'
}/WorkerFarm`);

function run() {
  let result = [process.pid];
  return new Promise((resolve, reject) => {
    WorkerFarm.callMaster({
      location: require.resolve('./master-process-id.js'),
      args: []
    })
      .then(pid => {
        result.push(pid);
        resolve(result);
      })
      .catch(reject);
  });
}

function init() {
  // Do nothing
}

exports.run = run;
exports.init = init;
