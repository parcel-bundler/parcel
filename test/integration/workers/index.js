navigator.serviceWorker.register('service-worker.js', { scope: './' });

new Worker('worker.js');
