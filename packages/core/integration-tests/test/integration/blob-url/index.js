let worker = new Worker(new URL('blob-url:./worker', import.meta.url), {type: 'module'});
worker.postMessage('test');
