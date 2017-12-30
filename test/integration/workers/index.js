navigator.serviceWorker.register('service-worker.js', { scope: './' });

var worker = new Worker('worker.js');
