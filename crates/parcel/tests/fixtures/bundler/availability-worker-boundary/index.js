const value = require('./value');
console.log(value);
new Worker(new URL('./worker-a.js', import.meta.url), {type: 'module'});
