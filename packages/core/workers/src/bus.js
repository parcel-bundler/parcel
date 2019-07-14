// @flow
import EventEmitter from 'events';

let WorkerFarm;

class Bus extends EventEmitter {
  emit(event: string, ...args: Array<any>): boolean {
    if (!WorkerFarm) {
      WorkerFarm = require('./WorkerFarm').default; // circular dep
    }

    if (WorkerFarm.isWorker()) {
      WorkerFarm.callMaster(
        {
          location: __filename,
          method: 'emit',
          args: [event, ...args]
        },
        false
      );
      return true;
    } else {
      return super.emit(event, ...args);
    }
  }
}

export default new Bus();
