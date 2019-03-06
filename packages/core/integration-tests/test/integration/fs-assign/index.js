var fs;
fs = require('fs');
module.exports = fs.readFileSync(__dirname + '/test.txt', 'utf8');
