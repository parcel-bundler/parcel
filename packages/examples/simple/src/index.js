const message = require('./message');
const fs = require('fs');

console.log(message); // eslint-disable-line no-console
console.log(fs.readFileSync(__dirname + '/test.txt', 'utf8'));
