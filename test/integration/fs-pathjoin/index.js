var fs = require('fs');
var path = require('path');
module.exports = fs.readFileSync(path.join(__dirname, '/test.txt'), 'utf8');
