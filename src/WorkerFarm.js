const {EventEmitter} = require('events');
const Farm = require('worker-farm/lib/farm');
const promisify = require('./utils/promisify');

class WorkerFarm extends Farm {
  constructor(path, options) {
    super(options, path);

    let res = this.setup();
    if (typeof res === 'object') {
      for (let key of res) {
        this[key] = promisify(res[key]);
      }
    } else {
      this.run = promisify(res);
    }
  }

  receive(data) {
    if (data.event) {
      this.emit(data.event, ...data.args);
    } else {
      super.receive(data);
    }
  }
}

for (let key in EventEmitter.prototype) {
  WorkerFarm.prototype[key] = EventEmitter.prototype[key];
}

module.exports = WorkerFarm;
