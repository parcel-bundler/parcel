let worker = new Worker('blob-url:./worker');
worker.postMessage('test');
