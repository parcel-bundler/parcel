var fs = require('fs');
module.exports = fs.readFileSync(__dirname + '../../../../../../../package.json', 'utf8');
