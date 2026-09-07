const value = require('./value');
console.log(value);
new Worker(new URL('./worker-b.js', import.meta.url), {type: 'module'});
import('./lazy').then(m => console.log(m.value));
