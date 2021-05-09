new Worker("dedicated-worker.js", {name: 'worker', type: 'module'});
new SharedWorker("shared-worker.js", {name: 'shared', type: 'module'});
