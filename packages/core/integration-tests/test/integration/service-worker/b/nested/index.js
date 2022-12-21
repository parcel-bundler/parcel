navigator.serviceWorker.register(new URL('worker-nested.js', import.meta.url), { scope: './' });
