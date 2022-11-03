import '../b/nested'

navigator.serviceWorker.register(new URL('../b/worker-outside.js', import.meta.url));
