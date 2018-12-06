import('./async');
import('./async2');

new Worker('./worker.js');

// const message = require('./message');
// const fs = require('fs');

// console.log(message); // eslint-disable-line no-console
// console.log(fs.readFileSync(__dirname + '/test.txt', 'utf8'));

class Test {}
