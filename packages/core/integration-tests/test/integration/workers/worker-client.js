const commonText = require('./common').commonFunction('Index');

navigator.serviceWorker.register(new URL('service-worker.js', import.meta.url), { scope: './' });

exports.startWorker = function() {
  const worker = new Worker(new URL('worker.js', import.meta.url), {type: 'module', name: 'myName'});
  worker.postMessage(commonText);
};

exports.startSharedWorker = function() {
  const worker = new SharedWorker(new URL('shared-worker.js', import.meta.url), {type: 'module'});
};


