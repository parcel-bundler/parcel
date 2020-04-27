var {readFileSync, ...fs} = require('fs');
module.exports = readFileSync(__dirname + '/test.txt', 'utf8');
