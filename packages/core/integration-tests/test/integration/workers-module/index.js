new Worker(new URL("dedicated-worker.js", import.meta.url), {type: 'module'});
new SharedWorker(new URL("shared-worker.js", import.meta.url), {type: 'module'});
