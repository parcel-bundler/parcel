import './core.js';
new Worker(new URL('./worker3.js', import.meta.url), {type: 'module'});
