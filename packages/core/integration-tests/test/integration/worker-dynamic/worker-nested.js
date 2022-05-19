import('./async');

let worker = new Worker(new URL('worker.js', import.meta.url), {type: 'module'});
worker.addEventListener('message', postMessage);
