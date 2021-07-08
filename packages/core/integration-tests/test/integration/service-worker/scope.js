navigator.serviceWorker.register(new URL('module-worker.js', import.meta.url), {scope: 'foo', type: 'module'});
