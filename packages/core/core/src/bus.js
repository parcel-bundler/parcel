// @flow
import EventEmitter from 'events';
import WorkerFarm from '@parcel/workers';

class Bus extends EventEmitter {
  emit(event: string, ...args: Array<any>): boolean {
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

module.exports = new Bus();
