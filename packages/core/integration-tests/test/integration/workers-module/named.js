new Worker(new URL("dedicated-worker.js", import.meta.url), {name: 'worker', type: 'module'});
new SharedWorker(new URL("shared-worker.js", import.meta.url), {name: 'shared', type: 'module'});
