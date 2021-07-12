let worker = new Worker(new URL('worker-nested.js', import.meta.url), {type: 'module'});
worker.addEventListener('message', output);
