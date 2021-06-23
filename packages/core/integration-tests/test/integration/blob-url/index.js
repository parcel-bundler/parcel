let worker = new Worker('blob-url:./worker', {type: 'module'});
worker.postMessage('test');
