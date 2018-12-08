var readFileSync = require('fs').readFileSync;
module.exports = readFileSync(__dirname + '/test.txt', 'utf8');
