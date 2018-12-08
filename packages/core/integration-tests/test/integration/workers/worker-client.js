const commonText = require('./common').commonFunction('Index');

navigator.serviceWorker.register('service-worker.js', { scope: './' });

exports.startWorker = function() {
  const worker = new Worker('worker.js');
  worker.postMessage(commonText);
};

exports.startSharedWorker = function() {
  const worker = new SharedWorker('shared-worker.js');
};


