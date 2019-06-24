const WorkerFarm = require('../../../').default;
const Logger = require('@parcel/logger').default;

function run() {
  if (WorkerFarm.isWorker()) {
    // Only test this behavior in workers. Logging in the main process will
    // always work.
    Logger.info('omg it works');
    Logger.error('errors objects dont work yet');
  }
}

exports.run = run;
