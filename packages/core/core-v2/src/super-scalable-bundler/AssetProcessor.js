import path from 'path';
import Emittery from 'emittery';
import PQueue from 'p-queue';
import { fork } from 'child_process';

export default class AssetProcessor extends Emittery {
  constructor() {
    super();
    this.queue = new PQueue();
  }

  process(asset) {
    console.log(`Processing ${asset.filePath}`);
    return this.queue.add(() => this.processInWorker(asset));
  }

  processInWorker(asset) {
    let { filePath } = asset;
    return new Promise((resolve, reject) => {
      let worker = fork(path.join(__dirname, 'processAssetWorker.js'));
      worker.on('message', async (msg) => {
        let { eventName, ...data } = msg;
        if (eventName === 'finished') {
          worker.kill('SIGINT');
          await asset.setProcessed(data);
          resolve(data);
        } else {
          this.emit(eventName, data);
        }
      });

      worker.on('error', (err) => {
        reject(new Error('Failed to process asset', filePath));
      });

      worker.send(filePath);
    });
  }
}
