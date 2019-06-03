const WorkerFarm = require('../../../src/WorkerFarm').default;

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

exports.run = run;
