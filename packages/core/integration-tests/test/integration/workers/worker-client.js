const commonText = require('./common').commonFunction('Index');

navigator.serviceWorker.register('service-worker.js', { scope: './' });

exports.startWorker = () => {
  const worker = new Worker('worker.js');
  worker.postMessage(commonText);
};

exports.startSharedWorker = () => {
  const worker = new SharedWorker('shared-worker.js');
};


