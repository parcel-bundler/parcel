import path from 'path';
import Emittery from 'emittery';
import PQueue from 'p-queue';
import { isDirectory } from './fsPromisified';
import { fork } from 'child_process';

export default class Resolver extends Emittery {
  constructor() {
    super();
    this.queue = new PQueue({ concurrency: 8 });
  }
  
  async resolve(moduleRequest) {
    console.log(`Resolving ${moduleRequest.moduleIdentifier} from ${moduleRequest.sourcePath}`)
    return this.queue.add(() => this.resolveInWorker(moduleRequest));
  }

  resolveInWorker(moduleRequest) {
    return new Promise((resolve, reject) => {
      let worker = fork(path.join(__dirname, 'resolveWorker.js'));
      worker.on('message', (msg) => {
        this.emit('resolved', msg);
        resolve(msg);
        worker.kill('SIGINT');
      });

      worker.on('error', (err) => {
        reject(err);
      });

      worker.send(moduleRequest);
    });
  }
}
